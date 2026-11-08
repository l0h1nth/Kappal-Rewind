"""Single-event-loop replay references and recoverable, nonrecursive deletion."""

import asyncio
import os
import stat
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.catalog import DATASET_ID
from app.datasets import lookup_dataset


class CleanupPendingError(Exception):
    """The directory is hidden from discovery, but its cleanup did not finish."""


def delete_stored_dataset(root: Path, dataset_id: str) -> None:
    record = lookup_dataset(root, dataset_id)
    directory = record.parquet.parent
    if directory.parent.resolve() != root.resolve() or directory.name != dataset_id:
        raise OSError('Unexpected dataset path')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    try:
        directory_fd = os.open(directory.name, flags, dir_fd=root_fd)
        try:
            expected = {'observations.parquet', 'metadata.json'}
            if (set(os.listdir(directory_fd)) != expected or
                    any(not stat.S_ISREG(os.stat(name, dir_fd=directory_fd, follow_symlinks=False).st_mode)
                        for name in expected)):
                raise OSError('Unexpected dataset layout')
            tombstone = f'.delete-{dataset_id}-{uuid4().hex}'
            os.rename(directory.name, tombstone, src_dir_fd=root_fd, dst_dir_fd=root_fd)
            try:
                moved = os.stat(tombstone, dir_fd=root_fd, follow_symlinks=False)
                opened = os.fstat(directory_fd)
                if (moved.st_dev, moved.st_ino) != (opened.st_dev, opened.st_ino):
                    raise OSError('Dataset directory changed during deletion')
                # Descriptor-relative unlink never follows a replacement directory symlink.
                os.unlink('observations.parquet', dir_fd=directory_fd)
                os.unlink('metadata.json', dir_fd=directory_fd)
                os.rmdir(tombstone, dir_fd=root_fd)
            except OSError as error:
                # Never restore a partially deleted recording into the visible catalog.
                raise CleanupPendingError from error
        finally:
            os.close(directory_fd)
    finally:
        os.close(root_fd)


class DatasetLifecycle:
    """All state changes run synchronously on the one application event loop.

    No await separates a reference check from reserving deletion/opening. Filesystem
    work runs off-loop; the deletion reservation lasts until that worker completes.
    This deliberately does not coordinate multiple backend worker processes.
    """

    def __init__(self):
        self.references: dict[str, int] = {}
        self.deleting: set[str] = set()
        self.pending: set[asyncio.Task] = set()

    @staticmethod
    def validate_id(dataset_id: str) -> None:
        if dataset_id == 'builtin':
            raise HTTPException(403, 'The built-in assignment recording cannot be deleted.')
        if not DATASET_ID.fullmatch(dataset_id):
            raise HTTPException(422, 'Dataset ID must be 32 lowercase hexadecimal characters.')

    def acquire(self, dataset_id: str) -> None:
        if dataset_id == 'builtin':
            return
        self.validate_id(dataset_id)
        if dataset_id in self.deleting:
            raise HTTPException(409, 'Recording deletion is in progress. Choose another recording.')
        self.references[dataset_id] = self.references.get(dataset_id, 0) + 1

    def release(self, dataset_id: str) -> None:
        count = self.references.get(dataset_id, 0)
        if count <= 1:
            self.references.pop(dataset_id, None)
        else:
            self.references[dataset_id] = count - 1

    async def delete(self, root: Path, dataset_id: str) -> None:
        self.validate_id(dataset_id)
        if self.references.get(dataset_id, 0) or dataset_id in self.deleting:
            raise HTTPException(409, 'Recording is currently being replayed or deleted. Close it or switch recordings before retrying.')
        self.deleting.add(dataset_id)
        task = asyncio.create_task(run_in_threadpool(delete_stored_dataset, root, dataset_id))
        self.pending.add(task)

        def finished(completed):
            self.deleting.discard(dataset_id)
            self.pending.discard(completed)
            if not completed.cancelled():
                completed.exception()  # Consume errors even if the HTTP client left.

        task.add_done_callback(finished)
        # Client cancellation cannot release the reservation while files are changing.
        await asyncio.shield(task)

    async def finish_pending(self) -> None:
        if self.pending:
            await asyncio.gather(*self.pending, return_exceptions=True)

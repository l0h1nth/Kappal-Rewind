import { useCallback, useEffect, useRef, useState } from 'react';
import { parseReplayMessage, type ReplayCommand, type ReplayFrame } from '../types';

type Pending =
  | { kind: 'command'; command: ReplayCommand }
  | { kind: 'seek'; second: number; resume: boolean; stage: 'pause' | 'seek' | 'resume' };

function confirms(frame: ReplayFrame, command: ReplayCommand) {
  switch (command.type) {
    case 'play': return frame.playing || frame.second === frame.duration_seconds - 1;
    case 'pause': return !frame.playing;
    case 'reset': return frame.second === 0 && !frame.playing;
    case 'set_speed': return frame.speed === command.speed;
    case 'seek': return frame.second === command.second;
  }
}

export function useReplaySocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<ReplayFrame | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const deadlineRef = useRef<number | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPending = useCallback(() => {
    window.clearTimeout(deadlineRef.current);
    pendingRef.current = null;
    setBusy(false);
  }, []);

  const write = useCallback((command: ReplayCommand) => {
    const fail = (message: string) => {
      clearPending();
      frameRef.current = null;
      setFrame(null);
      setStatus('error');
      setError(message);
      socketRef.current?.close();
    };
    try {
      if (socketRef.current?.readyState !== WebSocket.OPEN) throw new Error('Socket closed');
      socketRef.current.send(JSON.stringify(command));
      window.clearTimeout(deadlineRef.current);
      // An acknowledgement timeout, never a frontend playback clock.
      deadlineRef.current = window.setTimeout(() => fail('Replay command timed out. Reconnect to start a new session.'), 5000);
      return true;
    } catch {
      fail('Could not send replay command. Reconnect to start a new session.');
      return false;
    }
  }, [clearPending]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    clearPending();
    frameRef.current = null;
    setStatus('connecting');
    setFrame(null);
    setError(null);
    // StrictMode's setup/cleanup probe cancels this before opening a duplicate connection.
    const timer = window.setTimeout(() => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/replay`);
      socketRef.current = socket;
      socket.onopen = () => { if (active) setStatus('connected'); };
      socket.onmessage = event => {
        if (!active) return;
        try {
          const message = parseReplayMessage(JSON.parse(event.data));
          if (message.type === 'error') {
            clearPending();
            setError(message.message);
            return;
          }
          const pending = pendingRef.current;
          if (pending?.kind === 'seek') {
            // Pause is a stream barrier: no future automatic frames can follow its response.
            if (pending.stage === 'pause' && !message.playing) {
              pending.stage = 'seek';
              if (!write({ type: 'seek', second: pending.second })) return;
            } else if (pending.stage === 'seek') {
              if (message.second !== pending.second || message.playing) return;
              if (pending.resume && message.second < message.duration_seconds - 1) {
                pending.stage = 'resume';
                if (!write({ type: 'play' })) return;
              } else clearPending();
            } else if (pending.stage === 'resume' && (message.playing || message.second === message.duration_seconds - 1)) {
              clearPending();
            }
          } else if (pending?.kind === 'command' && confirms(message, pending.command)) clearPending();
          frameRef.current = message;
          setFrame(message); // Complete server snapshot, never a merge of old positions.
          setError(null);
        } catch {
          clearPending();
          frameRef.current = null;
          setError('Invalid replay message received from server.');
          setFrame(null);
        }
      };
      socket.onerror = () => {
        if (active) {
          clearPending();
          setStatus('error');
          setError('Replay connection failed. Reconnect to start a new paused session.');
          frameRef.current = null;
          setFrame(null);
        }
      };
      socket.onclose = () => {
        if (active) {
          clearPending();
          socketRef.current = null;
          setStatus(previous => previous === 'error' ? 'error' : 'disconnected');
          frameRef.current = null;
          setFrame(null);
        }
      };
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(deadlineRef.current);
      pendingRef.current = null;
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
        if (socketRef.current === socket) socketRef.current = null;
      }
    };
  }, [attempt, clearPending, write]);

  const send = useCallback((command: ReplayCommand) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN || !frameRef.current || pendingRef.current) return false;
    setBusy(true);
    setError(null);
    if (command.type === 'seek') {
      const resume = frameRef.current.playing;
      pendingRef.current = { kind: 'seek', second: command.second, resume, stage: resume ? 'pause' : 'seek' };
      return write(resume ? { type: 'pause' } : command);
    }
    pendingRef.current = { kind: 'command', command };
    return write(command);
  }, [write]);

  return { frame, status, error, busy, send, reconnect: () => setAttempt(value => value + 1) };
}

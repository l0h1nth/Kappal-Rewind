import { useCallback, useEffect, useRef, useState } from 'react';
import { parseReplayMessage, type ReplayCommand, type ReplayFrame } from '../types';

export function useReplaySocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
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
          if (message.type === 'state') {
            setFrame(message);
            setError(null);
          } else setError(message.message);
        } catch {
          setError('Invalid replay message received from server.');
          setFrame(null);
        }
      };
      socket.onerror = () => {
        if (active) {
          setStatus('error');
          setError('Replay connection failed. Reconnect to start a new paused session.');
          setFrame(null);
        }
      };
      socket.onclose = () => {
        if (active) {
          socketRef.current = null;
          setStatus(previous => previous === 'error' ? 'error' : 'disconnected');
          setFrame(null); // Closed connections must not leave apparently current positions.
        }
      };
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
        if (socketRef.current === socket) socketRef.current = null;
      }
    };
  }, [attempt]);

  const send = useCallback((command: ReplayCommand) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    try { socket.send(JSON.stringify(command)); }
    catch { setError('Could not send replay command. Check the connection.'); }
  }, []);

  return { frame, status, error, send, reconnect: () => setAttempt(value => value + 1) };
}

export function istTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
}

export function elapsed(second: number) {
  return `${Math.floor(second / 60).toString().padStart(2, '0')}:${(second % 60).toString().padStart(2, '0')}`;
}

export function recordingDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', rest > 0 || !hours && !minutes ? `${rest}s` : ''].filter(Boolean).join(' ');
}

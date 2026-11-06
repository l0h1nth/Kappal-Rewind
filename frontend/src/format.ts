export function istTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
}

export function elapsed(second: number) {
  return `${Math.floor(second / 60).toString().padStart(2, '0')}:${(second % 60).toString().padStart(2, '0')}`;
}

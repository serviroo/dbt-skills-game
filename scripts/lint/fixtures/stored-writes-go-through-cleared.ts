export function save(key: string, out: string, setStored: (k: string, v: string) => void) {
  localStorage.setItem(key, out);
  window.localStorage.removeItem(key);
  setStored(key, out);
}

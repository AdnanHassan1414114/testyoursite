export const API_BASE = process.env.REACT_APP_API_URL || '';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}
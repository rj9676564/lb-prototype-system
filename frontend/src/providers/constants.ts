const envBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL?.trim();

const runtimeDefaultBaseUrl =
  typeof window !== "undefined"
    ? import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:9000`
      : window.location.origin
    : "http://127.0.0.1:9000";

export const BASE_URL = (envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : runtimeDefaultBaseUrl).replace(/\/+$/, "");
export const API_URL = `${BASE_URL}/api`;

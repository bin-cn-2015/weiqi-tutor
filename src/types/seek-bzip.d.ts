declare module "seek-bzip" {
  export function decode(data: Uint8Array): Uint8Array;
  const api: { decode: typeof decode };
  export default api;
}

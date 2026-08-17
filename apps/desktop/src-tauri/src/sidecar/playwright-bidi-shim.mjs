function unsupported() {
  return new Error("WebDriver BiDi is unavailable in the packaged browser worker");
}

export const BidiServer = {
  createAndStart() {
    throw unsupported();
  },
};

export class MapperCdpConnection {
  constructor() {
    throw unsupported();
  }
}

let returnPath = "/chat";

function isOverlayPath(pathname: string) {
  return pathname.startsWith("/settings");
}

function rememberReturnPath(pathname: string, search = "") {
  if (isOverlayPath(pathname)) return;
  returnPath = `${pathname}${search}` || "/chat";
}

function getReturnPath() {
  return returnPath;
}

export { getReturnPath, rememberReturnPath };

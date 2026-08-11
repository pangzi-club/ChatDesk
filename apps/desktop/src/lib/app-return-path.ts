let returnPath = "/dashboard";

function isOverlayPath(pathname: string) {
  return pathname.startsWith("/settings") || pathname.startsWith("/dev-tools/");
}

function rememberReturnPath(pathname: string, search = "") {
  if (isOverlayPath(pathname)) return;
  returnPath = `${pathname}${search}` || "/dashboard";
}

function getReturnPath() {
  return returnPath;
}

export { getReturnPath, rememberReturnPath };

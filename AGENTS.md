# Repository Guidelines

These instructions apply to the entire repository.

## Package Manager

- Use the pnpm version declared in `package.json` (`pnpm@9.15.9`).
- Prefer Corepack to activate the pinned version when necessary: `corepack prepare pnpm@9.15.9 --activate`.
- Use `pnpm` for installing dependencies and running scripts. Do not use npm or Yarn, and do not create their lockfiles.

## Required Final Step

- After completing every task, run `pnpm format` before reporting the result.
- Review the formatting changes and include all task-related formatted files in the final result.
- Run any additional checks appropriate to the change, such as `pnpm check` or `pnpm build`, after formatting.

## Development Server

- Never start or open a development server.
- Never attempt to repair, recreate, reinstall, or otherwise modify `node_modules`; report dependency issues instead.

## List Data and Loading States

- Use `@tanstack/react-query` for asynchronous list fetching, caching, refetching, and request state. Do not implement list request lifecycles with ad hoc `useEffect` and local loading state.
- Show a layout-matching skeleton while a list's initial query is loading. Do not replace the list with plain loading text or a spinner.
- Preserve existing content during background refetches when practical; reserve the full skeleton for the initial load or for cases where no usable list data is available.
- Keep empty, error, and loading states distinct.

## Destructive Confirmation

- Use the shared shadcn `AlertDialog` for destructive actions that require confirmation. Do not use `window.confirm` or other native confirmation dialogs.

# with-next example

`next-env.d.ts` is checked in so `tsc`/`verify:examples` can typecheck this example before anyone has run `next dev` or `next build`. Next.js rewrites that file on every build to its own default comment; the committed copy already matches Next's default, so the diff is a no-op. Do not "fix" the comment back to a custom note — it will just churn on the next build.

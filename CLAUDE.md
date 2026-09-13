# Working on this repo

- Always commit and push directly to `main`. Do not create feature branches or pull requests unless asked.
- GitHub Pages serves `main` from the repository root. `index.html` and `assets/` at the root are
  generated: run `npm run build` (typecheck + bundle + copy to root) before committing and commit
  the regenerated files together with the source change. Edit `src/index.html`, never the root one.

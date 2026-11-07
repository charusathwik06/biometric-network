# Apply and push the Member 3 completion

The GitHub connection used for this task currently rejects write operations (`403 Resource not accessible by integration`). These files are prepared and tested locally, but they have **not** been pushed. Apply them using your own authenticated Git checkout:

1. Download and extract `biometric-network-member3-completion.zip`.
2. In your existing repository, start from the latest `main` and create a new branch:

   ```bash
   cd ~/biometric-network
   git switch main
   git pull origin main
   git switch -c feature/dataset-integrity-complete
   ```

3. Copy the extracted bundle contents into the repository root. For example, when the extracted folder is in `~/Downloads`:

   ```bash
   cp -a ~/Downloads/biometric-network-member3/. .
   ```

   This adds the new hash/dataset/experiment/docs/tests files and replaces `package.json` plus the three sender scripts. It does not include a `dataset/` directory, biometric files, `.env`, `received/`, or benchmark output.

4. Run checks:

   ```bash
   npm install
   npm test
   node experiments/scanDataset.js ./dataset
   ```

5. Review the staged file list carefully. Do not stage your local dataset, `.env`, `received/`, packet captures, or raw results:

   ```bash
   git status --short
   git add README.md INSTALL.md package.json sender/client.js sender/batch.js sender/batch-parallel.js sender/upload.js src/utils/hash.js src/utils/dataset.js experiments/scanDataset.js experiments/benchmark.js tests/datasetIntegrity.test.js docs/WIRESHARK.md docs/REPORT_TEMPLATE.md
   git diff --cached --name-only
   git commit -m "feat(dataset): add integrity and evaluation workflow"
   git push -u origin feature/dataset-integrity-complete
   ```

6. Open a pull request from `feature/dataset-integrity-complete` into `main`, ask the team to review it, and merge only after all tests pass.

The new unit tests were run in the preparation environment. The full project test suite should also be run in your checkout after `npm install`, because this preparation environment does not have the existing Express/Axios dependencies installed and cannot reach GitHub to clone the repository.

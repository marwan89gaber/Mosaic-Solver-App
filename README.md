# Mosaic-Solver-App

Mosaic-Solver-App is a small web app for analyzing and solving Mosaic color-matching boards.

## Features

- Generate a board and solve it step by step.
- Paint the board manually and review the solver path.
- Import screenshots for automatic analysis.
- Validate crop and palette before final analysis.

## Project Structure

- `page.html` - app shell and modal UI
- `style.css` - layout and visual styling
- `logic.js` - front-end interaction, solver, and image workflow
- `server.py` - Flask backend for image analysis
- `requirements.txt` - Python dependencies

## Sample Screenshot

![Mosaic Solver sample screenshot](Screenshot.png)

## Run Locally

1. Create and activate a virtual environment.
2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Start the backend:

```powershell
python server.py
```

4. Open the app in your browser at:

```text
http://127.0.0.1:5000
```

## Notes

- The screenshot analysis workflow is local and runs through the Flask backend.
- If you add a `.venv/` folder or other local files, they are ignored by Git.

## Repository Name

This repository is intended to be named `Mosaic-Solver-App` when you create it on GitHub.

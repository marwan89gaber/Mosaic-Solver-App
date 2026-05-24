const COLOR_MAP = {
	t: "#6be0be",
	r: "#df5858",
	p: "#a773cb",
	d: "#5a5c75",
	g: "#58b15a",
	b: "#4f8fe8",
};

const COLOR_KEYS = Object.keys(COLOR_MAP);
const MAX_BEAM_WIDTH = 220;

let currentColorMap = { ...COLOR_MAP };

const boardEl = document.getElementById("board");
const paletteEl = document.getElementById("palette");
const newGameBtn = document.getElementById("newGameBtn");
const configArea = document.getElementById("configArea");
const rowsInput = document.getElementById("rowsInput");
const colsInput = document.getElementById("colsInput");
const movesInput = document.getElementById("movesInput");
const colorOptionsEl = document.getElementById("colorOptions");
const generateBtn = document.getElementById("generateBtn");
const autoSolveBtn = document.getElementById("autoSolveBtn");
const resetPaintBtn = document.getElementById("resetPaintBtn");
const statusEl = document.getElementById("status");
const selectedColorNameEl = document.getElementById("selectedColorName");
const movesLimitLabelEl = document.getElementById("movesLimitLabel");
const movesUsedLabelEl = document.getElementById("movesUsedLabel");
const solutionPanelEl = document.getElementById("solutionPanel");
const solutionSummaryEl = document.getElementById("solutionSummary");
const solutionCountEl = document.getElementById("solutionCount");
const solutionStepsEl = document.getElementById("solutionSteps");
const prevStepBtn = document.getElementById("prevStepBtn");
const nextStepBtn = document.getElementById("nextStepBtn");
const stageGridEl = document.querySelector(".stage-grid");
const boardWrapEl = document.querySelector(".board-wrap");
const imageInput = document.getElementById("imageInput");
const dropZone = document.getElementById("dropZone");
const analyzeBtn = document.getElementById("analyzeBtn");
const previewModal = document.getElementById("previewModal");
const previewImage = document.getElementById("previewImage");
const previewOverlay = document.getElementById("previewOverlay");
const bboxLeft = document.getElementById("bboxLeft");
const bboxTop = document.getElementById("bboxTop");
const bboxRight = document.getElementById("bboxRight");
const bboxBottom = document.getElementById("bboxBottom");
const previewPaletteEl = document.getElementById("previewPalette");
const confirmAnalyzeBtn = document.getElementById("confirmAnalyze");
const useDetectedBtn = document.getElementById("useDetected");
const closePreviewBtn = document.getElementById("closePreview");
const previewRows = document.getElementById("previewRows");
const previewCols = document.getElementById("previewCols");

let selectedColor = "t";
let selectedAllowedColors = new Set(COLOR_KEYS);

let mode = "idle";
let rows = 10;
let cols = 10;
let movesLimit = 6;
let matrix = [];
let initialPaintMatrix = [];
let solutionStates = [];
let solutionMoves = [];
let currentSolutionStep = 0;
let resizeRafId = 0;
let pendingImageFile = null;
let lastPreviewResponse = null;
let activeLoadingButton = null;

function setButtonLoading(button, isLoading, loadingText) {
	if (!button) {
		return;
	}

	if (isLoading) {
		if (!button.dataset.originalText) {
			button.dataset.originalText = button.textContent || "";
		}
		button.disabled = true;
		button.classList.add("loading-btn");
		button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${loadingText || button.dataset.originalText}</span>`;
		activeLoadingButton = button;
	} else {
		button.disabled = false;
		button.classList.remove("loading-btn");
		button.innerHTML = button.dataset.originalText || button.textContent || "";
		delete button.dataset.originalText;
		if (activeLoadingButton === button) {
			activeLoadingButton = null;
		}
	}
}

function closestColorKey(rgb) {
	let bestKey = COLOR_KEYS[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < COLOR_KEYS.length; i += 1) {
		const key = COLOR_KEYS[i];
		const hex = COLOR_MAP[key];
		const parsed = [
			parseInt(hex.slice(1, 3), 16),
			parseInt(hex.slice(3, 5), 16),
			parseInt(hex.slice(5, 7), 16),
		];
		const distance =
			(rgb[0] - parsed[0]) ** 2 +
			(rgb[1] - parsed[1]) ** 2 +
			(rgb[2] - parsed[2]) ** 2;
		if (distance < bestDistance) {
			bestDistance = distance;
			bestKey = key;
		}
	}
	return bestKey;
}

function cloneMatrix(source) {
	return source.map((row) => [...row]);
}

function matrixToKey(inputMatrix) {
	return inputMatrix.map((row) => row.join("")).join("|");
}

function isUniform(inputMatrix) {
	const first = inputMatrix[0][0];
	for (let row = 0; row < inputMatrix.length; row += 1) {
		for (let col = 0; col < inputMatrix[0].length; col += 1) {
			if (inputMatrix[row][col] !== first) {
				return false;
			}
		}
	}
	return true;
}

function getUniqueColorCount(inputMatrix) {
	const set = new Set();
	for (let row = 0; row < inputMatrix.length; row += 1) {
		for (let col = 0; col < inputMatrix[0].length; col += 1) {
			set.add(inputMatrix[row][col]);
		}
	}
	return set.size;
}

function getRegions(inputMatrix) {
	const regionList = [];
	const seen = new Set();
	const maxRow = inputMatrix.length;
	const maxCol = inputMatrix[0].length;

	for (let row = 0; row < maxRow; row += 1) {
		for (let col = 0; col < maxCol; col += 1) {
			const key = `${row},${col}`;
			if (seen.has(key)) {
				continue;
			}

			const color = inputMatrix[row][col];
			const cells = [];
			const queue = [[row, col]];
			seen.add(key);

			while (queue.length > 0) {
				const [cr, cc] = queue.shift();
				cells.push([cr, cc]);

				const neighbors = [
					[cr - 1, cc],
					[cr + 1, cc],
					[cr, cc - 1],
					[cr, cc + 1],
				];

				neighbors.forEach(([nr, nc]) => {
					if (nr < 0 || nr >= maxRow || nc < 0 || nc >= maxCol) {
						return;
					}

					const nk = `${nr},${nc}`;
					if (seen.has(nk)) {
						return;
					}

					if (inputMatrix[nr][nc] === color) {
						seen.add(nk);
						queue.push([nr, nc]);
					}
				});
			}

			regionList.push({
				color,
				cells,
				representative: cells[0],
			});
		}
	}

	return regionList;
}

function applyFloodMove(inputMatrix, startRow, startCol, nextColor) {
	const output = cloneMatrix(inputMatrix);
	const targetColor = output[startRow][startCol];
	if (targetColor === nextColor) {
		return output;
	}

	const maxRow = output.length;
	const maxCol = output[0].length;
	const queue = [[startRow, startCol]];
	const seen = new Set([`${startRow},${startCol}`]);

	while (queue.length > 0) {
		const [row, col] = queue.shift();
		if (output[row][col] !== targetColor) {
			continue;
		}

		output[row][col] = nextColor;

		const neighbors = [
			[row - 1, col],
			[row + 1, col],
			[row, col - 1],
			[row, col + 1],
		];

		neighbors.forEach(([nr, nc]) => {
			if (nr < 0 || nr >= maxRow || nc < 0 || nc >= maxCol) {
				return;
			}

			const key = `${nr},${nc}`;
			if (seen.has(key)) {
				return;
			}

			if (output[nr][nc] === targetColor) {
				seen.add(key);
				queue.push([nr, nc]);
			}
		});
	}

	return output;
}

function evaluateState(inputMatrix) {
	const uniqueColors = getUniqueColorCount(inputMatrix);
	const regions = getRegions(inputMatrix);
	let biggestRegion = 0;
	regions.forEach((region) => {
		if (region.cells.length > biggestRegion) {
			biggestRegion = region.cells.length;
		}
	});

	return {
		uniqueColors,
		regionCount: regions.length,
		biggestRegion,
		score: uniqueColors * 10000 + regions.length * 100 - biggestRegion,
	};
}

function solveBoard(startMatrix, allowedColors, limit) {
	if (isUniform(startMatrix)) {
		return [];
	}

	const allowed = [...allowedColors];
	let frontier = [
		{
			matrix: cloneMatrix(startMatrix),
			moves: [],
		},
	];

	const visited = new Map();
	visited.set(matrixToKey(startMatrix), 0);

	for (let depth = 0; depth < limit; depth += 1) {
		const candidates = [];

		for (let i = 0; i < frontier.length; i += 1) {
			const node = frontier[i];
			const regions = getRegions(node.matrix);

			for (let r = 0; r < regions.length; r += 1) {
				const region = regions[r];
				const [row, col] = region.representative;

				for (let c = 0; c < allowed.length; c += 1) {
					const color = allowed[c];
					if (color === region.color) {
						continue;
					}

					const nextMatrix = applyFloodMove(node.matrix, row, col, color);
					const key = matrixToKey(nextMatrix);
					const nextDepth = node.moves.length + 1;

					if (visited.has(key) && visited.get(key) <= nextDepth) {
						continue;
					}
					visited.set(key, nextDepth);

					const nextMoves = node.moves.concat({ row, col, color });
					if (isUniform(nextMatrix)) {
						return nextMoves;
					}

					const metrics = evaluateState(nextMatrix);
					candidates.push({
						matrix: nextMatrix,
						moves: nextMoves,
						score: metrics.score,
					});
				}
			}
		}

		if (candidates.length === 0) {
			break;
		}

		candidates.sort((a, b) => a.score - b.score || a.moves.length - b.moves.length);
		frontier = candidates.slice(0, MAX_BEAM_WIDTH);
	}

	return null;
}

function setStatus(text) {
	statusEl.textContent = text;
}

function updateMeta(movesUsedText = "-") {
	selectedColorNameEl.textContent = selectedColor.toUpperCase();
	movesLimitLabelEl.textContent = String(movesLimit);
	movesUsedLabelEl.textContent = movesUsedText;
}

function setAllowedColors(keys) {
	const filteredKeys = keys.filter((key) => COLOR_KEYS.includes(key));
	selectedAllowedColors = new Set(filteredKeys.length > 0 ? filteredKeys : COLOR_KEYS);
	if (!selectedAllowedColors.has(selectedColor)) {
		selectedColor = [...selectedAllowedColors][0];
	}
	renderColorOptions();
	renderPalette();
}

function setDetectedPalette(keys, rgbList) {
	currentColorMap = { ...COLOR_MAP };
	keys.forEach((key, index) => {
		const rgb = rgbList && rgbList[index];
		if (rgb) {
			currentColorMap[key] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
		}
	});
}

function applySolutionGuide(startMatrix) {
	const moves = solveBoard(startMatrix, selectedAllowedColors, movesLimit);
	if (!moves) {
		return false;
	}

	solutionMoves = moves;
	solutionStates = buildSolutionStates(startMatrix, moves);
	currentSolutionStep = 0;
	matrix = cloneMatrix(solutionStates[0]);
	mode = "preview";
	renderSolutionGuide();
	updateMeta(`0/${solutionMoves.length}`);
	return true;
}

function fitBoardSize() {
	if (matrix.length === 0) {
		return;
	}

	const rowCount = matrix.length;
	const colCount = matrix[0].length;
	const availableWidth = boardWrapEl.clientWidth || stageGridEl.clientWidth;
	const availableHeight = window.innerHeight - 84;
	const availableHeightForBoard = Math.max(180, availableHeight);
	const widthFromHeight = (availableHeightForBoard * colCount) / rowCount;
	const targetWidth = Math.min(availableWidth, widthFromHeight);
	const targetHeight = (targetWidth * rowCount) / colCount;

	boardEl.style.width = `${Math.floor(targetWidth)}px`;
	boardEl.style.height = `${Math.floor(targetHeight)}px`;
}

function scheduleBoardFit() {
	window.cancelAnimationFrame(resizeRafId);
	resizeRafId = window.requestAnimationFrame(() => {
		fitBoardSize();
	});
}

function clearSolutionGuide() {
	solutionStates = [];
	solutionMoves = [];
	currentSolutionStep = 0;
	solutionPanelEl.classList.add("hidden");
	solutionSummaryEl.textContent = "No solution yet.";
	solutionCountEl.textContent = "0 / 0";
	solutionStepsEl.innerHTML = "";
	prevStepBtn.disabled = true;
	nextStepBtn.disabled = true;
}

function renderSolutionGuide() {
	if (solutionStates.length === 0) {
		clearSolutionGuide();
		return;
	}

	solutionPanelEl.classList.remove("hidden");
	solutionCountEl.textContent = `${currentSolutionStep} / ${solutionStates.length - 1}`;
	solutionSummaryEl.textContent =
		currentSolutionStep === 0
			? "Step 0 shows the painted board before any solver move."
			: `Step ${currentSolutionStep} applies move ${currentSolutionStep}.`;
	prevStepBtn.disabled = currentSolutionStep === 0;
	nextStepBtn.disabled = currentSolutionStep >= solutionStates.length - 1;
	solutionStepsEl.innerHTML = "";

	solutionMoves.forEach((move, index) => {
		const stepButton = document.createElement("button");
		stepButton.type = "button";
		stepButton.className = `solution-step${index + 1 === currentSolutionStep ? " active" : ""}`;
		stepButton.innerHTML = `<strong>Step ${index + 1}</strong><br />Click (${move.row + 1}, ${move.col + 1}) with ${move.color.toUpperCase()}`;
		stepButton.addEventListener("click", () => {
			showSolutionStep(index + 1);
		});
		solutionStepsEl.appendChild(stepButton);
	});

	renderBoard();
}

function showSolutionStep(stepIndex) {
	if (solutionStates.length === 0) {
		return;
	}

	currentSolutionStep = Math.max(0, Math.min(stepIndex, solutionStates.length - 1));
	matrix = cloneMatrix(solutionStates[currentSolutionStep]);
	if (currentSolutionStep > 0 && solutionMoves[currentSolutionStep - 1]) {
		selectedColor = solutionMoves[currentSolutionStep - 1].color;
	}
	renderPalette();
	renderSolutionGuide();
	updateMeta(`${currentSolutionStep}/${solutionMoves.length}`);
	const activeStepButton = solutionStepsEl.children[currentSolutionStep - 1];
	if (activeStepButton) {
		activeStepButton.scrollIntoView({ block: "nearest" });
	}
}

function buildSolutionStates(startMatrix, moves) {
	const states = [cloneMatrix(startMatrix)];
	let current = cloneMatrix(startMatrix);

	moves.forEach((move) => {
		current = applyFloodMove(current, move.row, move.col, move.color);
		states.push(cloneMatrix(current));
	});

	return states;
}

function renderColorOptions() {
	colorOptionsEl.innerHTML = "";

	COLOR_KEYS.forEach((key) => {
		const wrapper = document.createElement("label");
		wrapper.className = "color-option";

		const check = document.createElement("input");
		check.type = "checkbox";
		check.checked = selectedAllowedColors.has(key);
		check.addEventListener("change", () => {
			if (check.checked) {
				selectedAllowedColors.add(key);
			} else {
				selectedAllowedColors.delete(key);
			}

			if (selectedAllowedColors.size === 0) {
				selectedAllowedColors.add(key);
				check.checked = true;
			}
		});

		const dot = document.createElement("span");
		dot.className = "dot";
		dot.style.backgroundColor = COLOR_MAP[key];

		const name = document.createElement("span");
		name.textContent = key.toUpperCase();

		wrapper.append(check, dot, name);
		colorOptionsEl.appendChild(wrapper);
	});
}

function renderPalette() {
	paletteEl.innerHTML = "";
	const allowed = [...selectedAllowedColors];

	allowed.forEach((key) => {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `swatch${selectedColor === key ? " selected" : ""}`;
		btn.style.backgroundColor = currentColorMap[key] || COLOR_MAP[key];
		btn.setAttribute("aria-label", `Select color ${key}`);

		btn.addEventListener("click", () => {
			selectedColor = key;
			renderPalette();
			updateMeta(movesUsedLabelEl.textContent);
		});

		paletteEl.appendChild(btn);
	});
}

function renderAllowedSwatches(rgbList, labels = []) {
	paletteEl.innerHTML = "";
	rgbList.forEach((rgb, index) => {
		const key = labels[index] || closestColorKey(rgb);
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `swatch${selectedColor === key ? " selected" : ""}`;
		btn.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
		btn.setAttribute("aria-label", `Select color ${key}`);
		btn.addEventListener("click", () => {
			selectedColor = key;
			renderAllowedSwatches(rgbList, labels);
			updateMeta(movesUsedLabelEl.textContent);
		});
		paletteEl.appendChild(btn);
	});
}

function handleCellClick(row, col) {
	if (mode === "paint") {
		matrix[row][col] = selectedColor;
		initialPaintMatrix = cloneMatrix(matrix);
		renderBoard();
		return;
	}

	if (mode !== "preview") {
		return;
	}
}

function renderBoard() {
	boardEl.innerHTML = "";
	if (matrix.length === 0) {
		return;
	}

	const rowCount = matrix.length;
	const colCount = matrix[0].length;
	boardEl.style.setProperty("--rows", rowCount);
	boardEl.style.setProperty("--cols", colCount);
	boardEl.style.setProperty("--aspect", `${colCount} / ${rowCount}`);
	boardEl.style.aspectRatio = `${colCount} / ${rowCount}`;
	fitBoardSize();

	for (let row = 0; row < rowCount; row += 1) {
		for (let col = 0; col < colCount; col += 1) {
			const cell = document.createElement("button");
			cell.type = "button";
			cell.className = "cell";
			cell.style.backgroundColor = currentColorMap[matrix[row][col]] || COLOR_MAP[matrix[row][col]];
			cell.setAttribute("aria-label", `Cell ${row + 1},${col + 1}`);
			if (
				solutionStates.length > 0 &&
				currentSolutionStep > 0 &&
				solutionMoves[currentSolutionStep - 1] &&
				solutionMoves[currentSolutionStep - 1].row === row &&
				solutionMoves[currentSolutionStep - 1].col === col
			) {
				cell.classList.add("solution-target");
			}
			cell.addEventListener("click", () => handleCellClick(row, col));
			boardEl.appendChild(cell);
		}
	}
}

function buildBlankMatrix(r, c, fillColor) {
	const result = [];
	for (let row = 0; row < r; row += 1) {
		const nextRow = [];
		for (let col = 0; col < c; col += 1) {
			nextRow.push(fillColor);
		}
		result.push(nextRow);
	}
	return result;
}

function generateGameBoard() {
	rows = Number(rowsInput.value);
	cols = Number(colsInput.value);
	movesLimit = Number(movesInput.value);

	if (!Number.isInteger(rows) || rows < 3 || rows > 20) {
		setStatus("Rows must be from 3 to 20.");
		return;
	}
	if (!Number.isInteger(cols) || cols < 3 || cols > 20) {
		setStatus("Columns must be from 3 to 20.");
		return;
	}
	if (!Number.isInteger(movesLimit) || movesLimit < 1 || movesLimit > 40) {
		setStatus("Moves limit must be from 1 to 40.");
		return;
	}
	if (selectedAllowedColors.size < 2) {
		setStatus("Select at least 2 colors.");
		return;
	}

	const allowed = [...selectedAllowedColors];
	if (!selectedAllowedColors.has(selectedColor)) {
		selectedColor = allowed[0];
	}

	matrix = buildBlankMatrix(rows, cols, selectedColor);
	initialPaintMatrix = cloneMatrix(matrix);
	mode = "paint";
	clearSolutionGuide();

	autoSolveBtn.disabled = false;
	resetPaintBtn.disabled = false;

	renderPalette();
	renderBoard();
	updateMeta("-");
	setStatus(
		"Paint your starting board. Choose color below, then click cells to paint."
	);
}

function resetPaint() {
	if (mode !== "paint") {
		return;
	}
	matrix = cloneMatrix(initialPaintMatrix);
	renderBoard();
	setStatus("Board reset. Continue painting.");
}

function prepareSolutionGuide() {
	if (mode !== "paint") {
		return false;
	}

	return applySolutionGuide(cloneMatrix(matrix));
}

async function analyzeImageFile(file) {
	if (!file) {
		setStatus("Choose an image first.");
		return;
	}

	// First request preview so user can validate the crop and palette
	setStatus("Detecting board (preview)...");
	setButtonLoading(analyzeBtn, true, "Analyzing...");
	try {
		const formData = new FormData();
		formData.append("image", file);

		const resp = await fetch("/api/analyze/preview", { method: "POST", body: formData });
		const preview = await resp.json();
		if (!resp.ok) throw new Error(preview.error || "Preview failed");

		lastPreviewResponse = preview;
		openPreviewModal(file, preview);
		setStatus("Preview available — adjust crop or use detected and confirm.");
		setDetectedPalette(preview.paletteKeys || COLOR_KEYS, preview.paletteRGBs || []);
	} catch (err) {
		setStatus(err instanceof Error ? err.message : "Preview failed");
	} finally {
		setButtonLoading(analyzeBtn, false);
	}
}

function openPreviewModal(file, preview) {
	previewModal.classList.remove("hidden");
	// load image blob
	const url = URL.createObjectURL(file);
	previewImage.src = url;

	// set detected bbox (normalized)
	const norm = preview.normBBox || [0.12, 0.19, 0.88, 0.76];
	bboxLeft.value = norm[0];
	bboxTop.value = norm[1];
	bboxRight.value = norm[2];
	bboxBottom.value = norm[3];

	previewRows.value = preview.rows || rowsInput.value;
	previewCols.value = preview.cols || colsInput.value;

	renderPreviewPalette(preview.paletteRGBs || [], preview.paletteLabels || []);
	updateOverlayFromInputs();
}

function renderPreviewPalette(rgbList, labels = []) {
	previewPaletteEl.innerHTML = "";
	(rgbList || []).forEach((rgb, index) => {
		const key = labels[index] || closestColorKey(rgb);
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "swatch";
		btn.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
		btn.title = key.toUpperCase();
		btn.setAttribute("aria-label", `Palette color ${key}`);
		previewPaletteEl.appendChild(btn);
	});
}

function updateOverlayFromInputs() {
	let left = Number.parseFloat(bboxLeft.value);
	let top = Number.parseFloat(bboxTop.value);
	let right = Number.parseFloat(bboxRight.value);
	let bottom = Number.parseFloat(bboxBottom.value);

	if (!Number.isFinite(left)) left = 0;
	if (!Number.isFinite(top)) top = 0;
	if (!Number.isFinite(right)) right = 1;
	if (!Number.isFinite(bottom)) bottom = 1;

	left = Math.min(1, Math.max(0, left));
	top = Math.min(1, Math.max(0, top));
	right = Math.min(1, Math.max(0, right));
	bottom = Math.min(1, Math.max(0, bottom));

	// enforce minimum visible crop thickness in both axes
	const minGap = 0.01;
	if (right - left < minGap) {
		right = Math.min(1, left + minGap);
		left = Math.max(0, right - minGap);
	}
	if (bottom - top < minGap) {
		bottom = Math.min(1, top + minGap);
		top = Math.max(0, bottom - minGap);
	}

	bboxLeft.value = left.toFixed(3);
	bboxTop.value = top.toFixed(3);
	bboxRight.value = right.toFixed(3);
	bboxBottom.value = bottom.toFixed(3);

	previewOverlay.style.left = `${left * 100}%`;
	previewOverlay.style.top = `${top * 100}%`;
	previewOverlay.style.width = `${Math.max(0.5, (right - left) * 100)}%`;
	previewOverlay.style.height = `${Math.max(0.5, (bottom - top) * 100)}%`;
}

function closePreviewModal() {
	previewModal.classList.add("hidden");
	previewImage.src = "";
}

function queueImageAnalysis(file) {
	if (!file) {
		return;
	}
	pendingImageFile = file;
	analyzeImageFile(file);
}

// Wire preview controls
	bboxLeft.addEventListener("input", updateOverlayFromInputs);
	bboxTop.addEventListener("input", updateOverlayFromInputs);
	bboxRight.addEventListener("input", updateOverlayFromInputs);
	bboxBottom.addEventListener("input", updateOverlayFromInputs);

	// +/- buttons for sliders and numeric inputs
	document.querySelectorAll(".small-btn").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			const targetId = btn.getAttribute("data-target");
			if (!targetId) return;
			const el = document.getElementById(targetId);
			if (!el) return;

			const isRange = el.type === "range";
			const step = parseFloat(el.getAttribute("step") || (isRange ? "0.001" : "1"));
			const delta = btn.classList.contains("inc") ? step : -step;

			if (isRange) {
				let v = parseFloat(el.value || "0");
				v = Math.min(1, Math.max(0, v + delta));
				el.value = v.toFixed(3);
				updateOverlayFromInputs();
			} else if (el.type === "number") {
				let v = parseFloat(el.value || el.min || 0);
				v = Math.min(parseFloat(el.max || v + 9999), Math.max(parseFloat(el.min || -9999), v + delta));
				el.value = Math.round(v);
			}
		});
	});
closePreviewBtn.addEventListener("click", () => closePreviewModal());

useDetectedBtn.addEventListener("click", async () => {
	// Use detected values directly (no bbox override)
	closePreviewModal();
	if (lastPreviewResponse) {
		// apply detected values and run analyze
		rowsInput.value = lastPreviewResponse.rows || rowsInput.value;
		colsInput.value = lastPreviewResponse.cols || colsInput.value;
		setDetectedPalette(lastPreviewResponse.paletteKeys || COLOR_KEYS, lastPreviewResponse.paletteRGBs || []);
		setAllowedColors(lastPreviewResponse.paletteKeys || COLOR_KEYS);
		// call analyze with same file
		analyzeImageConfirm(pendingImageFile || (imageInput.files && imageInput.files[0]));
	}
});

confirmAnalyzeBtn.addEventListener("click", async () => {
	// send bbox override along with image to /api/analyze
	const file = pendingImageFile || (imageInput.files && imageInput.files[0]);
	if (!file) {
		setStatus("No image file available for analysis.");
		return;
	}

	const norm = [parseFloat(bboxLeft.value), parseFloat(bboxTop.value), parseFloat(bboxRight.value), parseFloat(bboxBottom.value)];
	setButtonLoading(confirmAnalyzeBtn, true, "Analyzing...");
	closePreviewModal();
	analyzeImageConfirm(file, norm);
});

async function analyzeImageConfirm(file, normBBox = null) {
	setStatus("Analyzing image with Python...");
	setButtonLoading(analyzeBtn, true, "Analyzing...");
	try {
		const formData = new FormData();
		formData.append("image", file);
		if (normBBox) formData.append("bbox", JSON.stringify(normBBox));

		const response = await fetch("/api/analyze", {
			method: "POST",
			body: formData,
		});

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error || "Image analysis failed.");
		}

		rowsInput.value = payload.rows;
		colsInput.value = payload.cols;
		rows = Number(payload.rows);
		cols = Number(payload.cols);

		movesLimit = Number(movesInput.value);

		setDetectedPalette(payload.paletteKeys || COLOR_KEYS, payload.paletteRGBs || []);
		setAllowedColors(payload.paletteKeys || COLOR_KEYS);
		matrix = payload.board;
		initialPaintMatrix = cloneMatrix(matrix);
		clearSolutionGuide();
		renderBoard();
		updateMeta("-");

		const solved = applySolutionGuide(cloneMatrix(matrix));
		if (!solved) {
			setStatus(
				"Image analyzed, but the solver could not find a path within the moves limit. Try a larger limit."
			);
			return;
		}

		setStatus(
			"Image analyzed. The board and step-by-step solution are ready on screen."
		);
		scheduleBoardFit();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Could not analyze the image.");
	} finally {
		setButtonLoading(analyzeBtn, false);
		setButtonLoading(confirmAnalyzeBtn, false);
	}
}

function runAutoSolve() {
	if (mode !== "paint") {
		setStatus("Generate and paint a board first.");
		return;
	}

	setStatus("Finding a solution guide...");
	autoSolveBtn.disabled = true;
	const solved = prepareSolutionGuide();
	autoSolveBtn.disabled = false;

	if (!solved) {
		setStatus(
			"No solution found within the moves limit. Try increasing limit or repainting the board."
		);
		return;
	}

	setStatus(
		`Solution guide ready. Use the left/right buttons or step list to review ${solutionMoves.length} moves.`
	);
}

function init() {
	renderColorOptions();
	renderPalette();
	updateMeta("-");
	clearSolutionGuide();
	window.addEventListener("resize", scheduleBoardFit);

	dropZone.addEventListener("click", () => {
		imageInput.value = "";
		imageInput.click();
	});
	dropZone.addEventListener("dragover", (event) => {
		event.preventDefault();
		dropZone.classList.add("drag-over");
	});
	dropZone.addEventListener("dragleave", () => {
		dropZone.classList.remove("drag-over");
	});
	dropZone.addEventListener("drop", (event) => {
		event.preventDefault();
		dropZone.classList.remove("drag-over");
		const file = event.dataTransfer.files[0];
		queueImageAnalysis(file);
	});
	dropZone.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			imageInput.click();
		}
	});
	imageInput.addEventListener("change", () => {
		queueImageAnalysis(imageInput.files[0] || null);
	});

	newGameBtn.addEventListener("click", () => {
		configArea.classList.toggle("hidden");
		if (!configArea.classList.contains("hidden")) {
			setStatus("Set board size, colors, and moves limit, then click Generate.");
		}
	});

	generateBtn.addEventListener("click", generateGameBoard);
	autoSolveBtn.addEventListener("click", runAutoSolve);
	resetPaintBtn.addEventListener("click", resetPaint);
	analyzeBtn.addEventListener("click", () => {
		analyzeImageFile(pendingImageFile || imageInput.files[0] || null);
	});
	prevStepBtn.addEventListener("click", () => {
		showSolutionStep(currentSolutionStep - 1);
	});
	nextStepBtn.addEventListener("click", () => {
		showSolutionStep(currentSolutionStep + 1);
	});
	scheduleBoardFit();
}

init();

// ===== Elements =====
const exprEl = document.getElementById("expr");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");
const historyListEl =
	document.getElementById("historyList");
const clearHistoryBtn =
	document.getElementById("clearHistory");
const themeToggle = document.getElementById("themeToggle");

// ===== State =====
let expression = "";
let lastResult = "";
let history = loadHistory();

// ===== Init =====
render();
renderHistory();
initTheme();

// Click handling (buttons)
document.querySelectorAll("[data-key]").forEach((btn) => {
	btn.addEventListener("click", () =>
		handleKey(btn.dataset.key)
	);
});

// Keyboard handling
window.addEventListener("keydown", (e) => {
	const k = e.key;

	// allow ctrl/cmd shortcuts to work normally
	if (e.ctrlKey || e.metaKey) return;

	const allowed =
		"0123456789.+-*/()".includes(k) ||
		k === "Enter" ||
		k === "Backspace" ||
		k === "Escape";

	if (!allowed) return;

	e.preventDefault();
	handleKey(k);
});

// History controls
clearHistoryBtn.addEventListener("click", () => {
	history = [];
	saveHistory(history);
	renderHistory();
});

// Theme toggle
themeToggle.addEventListener("click", () => {
	const root = document.documentElement;
	const next =
		root.dataset.theme === "light" ? "dark" : "light";
	root.dataset.theme = next;
	localStorage.setItem("calc_theme", next);
});

// ===== Input Handling =====
function handleKey(key) {
	clearError();

	if (key === "Escape" || key === "AC") {
		expression = "";
		lastResult = "";
		render();
		return;
	}

	if (key === "Backspace") {
		expression = expression.slice(0, -1);
		render();
		return;
	}

	if (key === "Enter") {
		evaluateAndCommit();
		return;
	}

	// If user starts typing after a result, keep it intuitive:
	// - typing a number starts a new expression
	// - typing an operator continues from the result
	if (
		lastResult &&
		expression === "" &&
		"0123456789.".includes(key)
	) {
		lastResult = "";
	}
	if (
		lastResult &&
		expression === "" &&
		"+-*/".includes(key)
	) {
		expression = lastResult;
		lastResult = "";
	}

	// Prevent two operators in a row (basic UX guard)
	if ("+-*/".includes(key)) {
		const last = expression.slice(-1);
		if (expression === "" && key !== "-") return; // allow starting negative
		if ("+-*/".includes(last)) return;
	}

	// Prevent double dots in the same number segment
	if (key === ".") {
		const seg = expression.split(/[\+\-\*\/\(\)]/).pop();
		if (seg.includes(".")) return;
	}

	expression += key;
	renderLivePreview();
	render();
}

// ===== Evaluate =====
function evaluateAndCommit() {
	if (!expression.trim()) return;

	const out = safeEvaluate(expression);

	if (!out.ok) {
		showError(out.message);
		render();
		return;
	}

	const res = out.value;
	lastResult = res;

	// Commit to history
	history.unshift({
		expr: expression,
		result: res,
		ts: Date.now(),
	});
	history = history.slice(0, 25);
	saveHistory(history);
	renderHistory();

	// Clear expression, show result big
	expression = "";
	render();
}

// Live preview (optional): shows a small result while typing if valid
function renderLivePreview() {
	if (!expression.trim()) {
		resultEl.textContent = "";
		return;
	}
	const out = safeEvaluate(expression, {
		allowPartial: true,
	});
	if (out.ok) resultEl.textContent = out.value;
}

// ===== Rendering =====
function render() {
	exprEl.textContent =
		expression || (lastResult ? "" : "0");
	if (lastResult) {
		resultEl.textContent = lastResult;
	} else if (!expression) {
		// keep result empty when idle
		// resultEl.textContent = "";
	}
}

function renderHistory() {
	historyListEl.innerHTML = "";

	if (history.length === 0) {
		const li = document.createElement("li");
		li.className = "historyItem";
		li.innerHTML = `<div class="historyExpr">No history yet</div>
                    <div class="historyRes">Try: (2+3)*7</div>`;
		historyListEl.appendChild(li);
		return;
	}

	history.forEach((item) => {
		const li = document.createElement("li");
		li.className = "historyItem";
		li.tabIndex = 0;
		li.setAttribute("role", "button");
		li.setAttribute(
			"aria-label",
			`Reuse result ${item.result}`
		);

		li.innerHTML = `
      <div class="historyExpr">${escapeHtml(
				item.expr
			)}</div>
      <div class="historyRes">${escapeHtml(
				item.result
			)}</div>
    `;

		li.addEventListener("click", () => {
			// reuse result
			expression += item.result;
			lastResult = "";
			clearError();
			renderLivePreview();
			render();
		});

		li.addEventListener("keydown", (e) => {
			if (e.key === "Enter") li.click();
		});

		historyListEl.appendChild(li);
	});
}

// ===== Theme =====
function initTheme() {
	const saved = localStorage.getItem("calc_theme");
	if (saved === "light" || saved === "dark") {
		document.documentElement.dataset.theme = saved;
		return;
	}
	// default: respect system preference
	const prefersLight = window.matchMedia?.(
		"(prefers-color-scheme: light)"
	)?.matches;
	document.documentElement.dataset.theme = prefersLight
		? "light"
		: "dark";
}

// ===== Error UI =====
function showError(msg) {
	errorEl.textContent = msg;
}
function clearError() {
	errorEl.textContent = "";
}

// ===== Storage =====
function loadHistory() {
	try {
		const raw = localStorage.getItem("calc_history");
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
function saveHistory(h) {
	localStorage.setItem("calc_history", JSON.stringify(h));
}

// ===== Safe Math Engine (Tokenizer -> RPN -> Evaluate) =====
function safeEvaluate(input, opts = {}) {
	const allowPartial = !!opts.allowPartial;

	try {
		const tokens = tokenize(input);
		if (tokens.length === 0)
			return { ok: false, message: "Empty expression" };

		// If partial typing ends with operator, treat as not-ready (no error spam)
		const last = tokens[tokens.length - 1];
		if (
			allowPartial &&
			(isOperator(last) || last === "(")
		) {
			return {
				ok: false,
				message: "Incomplete expression",
			};
		}

		const rpn = toRpn(tokens);
		const value = evalRpn(rpn);

		if (!Number.isFinite(value)) {
			return {
				ok: false,
				message: "Math error (division by zero?)",
			};
		}

		return { ok: true, value: formatNumber(value) };
	} catch (err) {
		// Don’t leak raw errors to users
		return { ok: false, message: "Invalid expression" };
	}
}

function tokenize(str) {
	const s = str.replace(/\s+/g, "");
	const out = [];
	let i = 0;

	while (i < s.length) {
		const c = s[i];

		// number (including decimals)
		if (isDigit(c) || c === ".") {
			let num = c;
			i++;
			while (
				i < s.length &&
				(isDigit(s[i]) || s[i] === ".")
			) {
				num += s[i++];
			}
			if (num === ".") throw new Error("bad number");
			out.push(num);
			continue;
		}

		// parentheses
		if (c === "(" || c === ")") {
			out.push(c);
			i++;
			continue;
		}

		// operators
		if ("+-*/".includes(c)) {
			// unary minus support: if '-' comes at start or after '(' or another operator
			const prev = out[out.length - 1];
			const unary =
				c === "-" &&
				(out.length === 0 ||
					prev === "(" ||
					isOperator(prev));
			if (unary) {
				out.push("u-"); // unary minus token
			} else {
				out.push(c);
			}
			i++;
			continue;
		}

		throw new Error("invalid char");
	}

	return out;
}

function toRpn(tokens) {
	const output = [];
	const ops = [];

	for (const t of tokens) {
		if (isNumber(t)) {
			output.push(t);
			continue;
		}

		if (t === "(") {
			ops.push(t);
			continue;
		}

		if (t === ")") {
			while (ops.length && ops[ops.length - 1] !== "(") {
				output.push(ops.pop());
			}
			if (ops.pop() !== "(") throw new Error("mismatch");
			continue;
		}

		// operator
		while (
			ops.length &&
			isOperator(ops[ops.length - 1]) &&
			(precedence(ops[ops.length - 1]) > precedence(t) ||
				(precedence(ops[ops.length - 1]) ===
					precedence(t) &&
					isLeftAssoc(t)))
		) {
			output.push(ops.pop());
		}
		ops.push(t);
	}

	while (ops.length) {
		const op = ops.pop();
		if (op === "(" || op === ")")
			throw new Error("mismatch");
		output.push(op);
	}

	return output;
}

function evalRpn(rpn) {
	const st = [];
	for (const t of rpn) {
		if (isNumber(t)) {
			st.push(Number(t));
			continue;
		}
		if (t === "u-") {
			const a = st.pop();
			st.push(-a);
			continue;
		}
		const b = st.pop();
		const a = st.pop();
		if (t === "+") st.push(a + b);
		else if (t === "-") st.push(a - b);
		else if (t === "*") st.push(a * b);
		else if (t === "/") st.push(a / b);
		else throw new Error("bad op");
	}
	if (st.length !== 1) throw new Error("bad expr");
	return st[0];
}

// ===== Helpers =====
function precedence(op) {
	if (op === "u-") return 3;
	if (op === "*" || op === "/") return 2;
	if (op === "+" || op === "-") return 1;
	return 0;
}
function isLeftAssoc(op) {
	return op !== "u-";
}
function isOperator(t) {
	return (
		t === "u-" ||
		t === "+" ||
		t === "-" ||
		t === "*" ||
		t === "/"
	);
}
function isNumber(t) {
	return /^(\d+(\.\d+)?|\.\d+)$/.test(t);
}
function isDigit(c) {
	return c >= "0" && c <= "9";
}
function formatNumber(n) {
	// Avoid floating weirdness in display while keeping precision reasonable
	const rounded =
		Math.round((n + Number.EPSILON) * 1e12) / 1e12;
	return String(rounded);
}
function escapeHtml(s) {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

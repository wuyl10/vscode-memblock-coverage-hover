"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const FIELD_LABELS = {
  alias: "别名",
  "auto-note": "自动说明",
  "belongs-to": "归属",
  "bin-kind": "Bin 类型",
  "bit-order": "Bit 顺序",
  bins: "Bins",
  covergroup: "Covergroup",
  coverpoint: "Coverpoint",
  coverpoints: "Coverpoints",
  decl: "声明",
  debug: "Debug",
  "debug-miss": "Miss 排查",
  "delay-cycles": "延迟拍数",
  "sample-relation": "采样关系",
  "delayed-from": "延迟来源",
  "driven-by": "驱动来源",
  "root-source": "原始来源",
  background: "背景",
  "backref-kind": "反标类型",
  excel: "Excel 测试点",
  "excel-category": "Excel 分类",
  example: "例子",
  expr: "表达式",
  kind: "类型",
  meaning: "含义",
  module: "所属模块",
  "not-proof": "注意",
  plain: "白话",
  role: "角色",
  "role-detail": "角色说明",
  "role-map-line": "角色映射行",
  "role-map-warning": "角色映射警告",
  "related-signals": "相关信号",
  rtl: "RTL 信号",
  sample: "采样",
  "secondary-category": "相关分类",
  stage: "流水级",
  "testpoint-id": "测试点编号",
  testpoints: "测试点",
  "mapped-covergroups": "指向 CG",
  used: "用于",
  "used-by": "用于",
  value: "取值",
  waveform: "看波形",
  when: "什么时候出现",
  why: "为什么这样写"
};

const CODE_FIELD_KEYS = new Set([
  "decl",
  "delayed-from",
  "driven-by",
  "expr",
  "rtl",
  "root-source",
  "sample-relation",
  "value"
]);

const KIND_LABELS = {
  testpoint: "Testpoint",
  signal: "Signal",
  covergroup: "Covergroup",
  coverpoint: "Coverpoint",
  bin: "Bin",
  cross: "Cross",
  meta: "Meta",
  unknown: "Unknown"
};

const KIND_ORDER = ["testpoint", "signal", "covergroup", "coverpoint", "bin", "cross", "meta", "unknown"];
const MODULE_PATTERNS = [
  [/`?Loadunit0_PATH\b|inner_LoadUnit_0\b/, "LoadUnit_0"],
  [/`?Loadunit1_PATH\b|inner_LoadUnit_1\b/, "LoadUnit_1"],
  [/`?StoreUnit0_PATH\b|inner_StoreUnit_0\b/, "StoreUnit_0"],
  [/`?atomicsUnit_PATH\b|inner_atomicsUnit\b/, "AtomicsUnit"],
  [/`?Sbuffer_PATH\b|inner_sbuffer\b/, "SBuffer"],
  [/`?Storequeue_PATH\b|storeQueue\b/, "StoreQueue"],
  [/`?DCacheWrapper_PATH\b|`?DCache_PATH\b|inner_dcache\b/, "DCache"],
  [/`?DcacheMp_PATH\b|mainPipe\b/, "DCache.MainPipe"],
  [/`?LoadPipe\b|ldu_0\b/, "DCache.LoadPipe"],
  [/`?Uncache_PATH\b|inner_uncache\b/, "Uncache"],
  [/`?PMP_PATH\b|inner_pmp\b/, "PMP"],
  [/`?MMU_PATH\b|inner_mmu\b/, "MMU"],
  [/`?Prefetcher_PATH\b|inner_prefetcher\b/, "Prefetcher"],
  [/`?L1prefetcher_PATH\b|inner_l1PrefetcherOpt\b/, "L1Prefetcher"],
  [/`?SMS_PATH\b|inner_prefetcherOpt\b/, "SMS"],
  [/`?CsrMod_PATH\b|csrMod\b/, "CSR"],
  [/`?MEMBLOCK_PATH\b/, "MemBlock"]
];
const COVERAGE_DOCUMENT_SELECTOR = [
  { scheme: "file", language: "systemverilog", pattern: "**/coverage/memblock/**/*.sv" },
  { scheme: "file", language: "verilog", pattern: "**/coverage/memblock/**/*.sv" },
  { scheme: "file", pattern: "**/coverage/memblock/**/*.sv" }
];
const ANNO_KIND_MAP = {
  "cov-signal": "signal",
  "cov-cg": "covergroup",
  "cov-covergroup": "covergroup",
  "cov-cp": "coverpoint",
  "cov-coverpoint": "coverpoint",
  "cov-bin": "bin",
  "cov-cross": "cross",
  "cov-meta": "meta"
};

const SYMBOLS_VIEW_FILTER_OPTIONS = [
  {
    value: "all",
    label: "All Symbols",
    detail: "Show testpoints, signals, covergroups, loose symbols, and meta."
  },
  {
    value: "primary",
    label: "Primary Closure",
    detail: "Show testpoints and covergroups listed as primary in the Covergroup role map."
  },
  {
    value: "secondary",
    label: "Secondary Context",
    detail: "Show testpoints and covergroups listed as secondary in the Covergroup role map."
  },
  {
    value: "unclassified",
    label: "Unclassified Covergroups",
    detail: "Show covergroups not listed in the Covergroup role map."
  },
  {
    value: "testpoints",
    label: "Testpoints Only",
    detail: "Show only the Section 0 testpoint directory."
  },
  {
    value: "covergroups",
    label: "Covergroups Only",
    detail: "Show only covergroups and their coverpoints/bins/crosses."
  },
  {
    value: "signals",
    label: "Signals Only",
    detail: "Show only RTL aliases, sampled signals, windows, and helpers."
  }
];
const SYMBOLS_VIEW_FILTER_VALUES = new Set(SYMBOLS_VIEW_FILTER_OPTIONS.map((item) => item.value));
const SYMBOLS_VIEW_FILTER_SECTIONS = {
  all: new Set(["testpoints", "signals", "covergroups", "looseCoverpoints", "looseBins", "looseCrosses", "meta", "unknown"]),
  primary: new Set(["testpoints", "covergroups"]),
  secondary: new Set(["testpoints", "covergroups"]),
  unclassified: new Set(["covergroups"]),
  testpoints: new Set(["testpoints"]),
  covergroups: new Set(["covergroups"]),
  signals: new Set(["signals"])
};

let output;
let statusBar;
let treeProvider;
let glossaryProvider;
let roleDiagnosticCollection;
let scanTimer;
let lineHighlightDecoration;
let lineHighlightTimer;

let canonicalDocs = [];
let symbolIndex = new Map();
let documentVersions = new Map();
let pendingDocumentIndexes = new Set();
let lastScanSummary = {
  files: 0,
  symbols: 0,
  aliases: 0,
  updatedAt: "never"
};

function activate(context) {
  output = vscode.window.createOutputChannel("MemBlock Coverage Hover");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = "memblockCoverageHover.searchSymbol";
  lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
    overviewRulerColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center
  });
  roleDiagnosticCollection = vscode.languages.createDiagnosticCollection("memblock-coverage-role-map");
  context.subscriptions.push(output, statusBar, lineHighlightDecoration, roleDiagnosticCollection);

  treeProvider = new SymbolTreeProvider();
  glossaryProvider = new GlossaryProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("memblockCoverageHover.symbols", treeProvider),
    vscode.workspace.registerTextDocumentContentProvider("memblock-hover-glossary", glossaryProvider)
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      COVERAGE_DOCUMENT_SELECTOR,
      new MemBlockHoverProvider()
    ),
    vscode.languages.registerDefinitionProvider(
      COVERAGE_DOCUMENT_SELECTOR,
      new MemBlockDefinitionProvider()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memblockCoverageHover.rescan", async () => {
      await rescanWorkspace(false);
    }),
    vscode.commands.registerCommand("memblockCoverageHover.searchSymbol", async () => {
      await searchSymbol();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.openGlossary", async () => {
      await openGlossary();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.toggleEnable", async () => {
      await toggleEnable();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.filterSymbolsView", async () => {
      await filterSymbolsView();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.validateRoleMap", async () => {
      await validateRoleMap();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.resetSymbolsViewFilter", async () => {
      await resetSymbolsViewFilter();
    }),
    vscode.commands.registerCommand("memblockCoverageHover.openLocation", async (filePath, oneBasedLine) => {
      await openPathLocation(filePath, oneBasedLine);
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/coverage/memblock/**/*.sv");
  watcher.onDidCreate((uri) => invalidateFile(uri.fsPath), null, context.subscriptions);
  watcher.onDidChange((uri) => invalidateFile(uri.fsPath), null, context.subscriptions);
  watcher.onDidDelete((uri) => invalidateFile(uri.fsPath), null, context.subscriptions);
  context.subscriptions.push(watcher);
  const sidecarWatcher = vscode.workspace.createFileSystemWatcher("**/coverage/memblock/hover_docs/**/*.md");
  sidecarWatcher.onDidCreate((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  sidecarWatcher.onDidChange((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  sidecarWatcher.onDidDelete((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  context.subscriptions.push(sidecarWatcher);
  const legacyDocWatcher = vscode.workspace.createFileSystemWatcher("**/coverage/memblock/doc/**/*.md");
  legacyDocWatcher.onDidCreate((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  legacyDocWatcher.onDidChange((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  legacyDocWatcher.onDidDelete((uri) => invalidateSidecar(uri.fsPath), null, context.subscriptions);
  context.subscriptions.push(legacyDocWatcher);

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("memblockCoverageHover.symbolsViewFilter")) {
      refreshFilterContext();
      updateStatusBar();
      if (treeProvider) {
        treeProvider.refresh();
      }
      return;
    }
    if (event.affectsConfiguration("memblockCoverageHover")) {
      refreshEnabledContext();
      scheduleRescan();
    }
  }, null, context.subscriptions);
  vscode.window.onDidChangeActiveTextEditor(() => {
    if (treeProvider) {
      treeProvider.refresh();
    }
  }, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument((event) => {
    const active = vscode.window.activeTextEditor;
    if (active && event.document === active.document && isCoverageFile(event.document.uri.fsPath) && treeProvider) {
      treeProvider.refresh();
    }
  }, null, context.subscriptions);

  refreshEnabledContext();
  refreshFilterContext();
  updateStatusBar();

  if (getConfig().get("scanOnStartup", false)) {
    rescanWorkspace(true);
  }
}

function deactivate() {
  if (scanTimer) {
    clearTimeout(scanTimer);
  }
  if (lineHighlightTimer) {
    clearTimeout(lineHighlightTimer);
  }
}

function getConfig() {
  return vscode.workspace.getConfiguration("memblockCoverageHover");
}

function isEnabled() {
  return getConfig().get("enable", true);
}

function symbolsViewFilter() {
  const value = getConfig().get("symbolsViewFilter", "all");
  return SYMBOLS_VIEW_FILTER_VALUES.has(value) ? value : "all";
}

function symbolsViewFilterOption(value = symbolsViewFilter()) {
  return SYMBOLS_VIEW_FILTER_OPTIONS.find((item) => item.value === value) || SYMBOLS_VIEW_FILTER_OPTIONS[0];
}

function symbolsViewFilterLabel(value = symbolsViewFilter()) {
  return symbolsViewFilterOption(value).label;
}

function refreshEnabledContext() {
  vscode.commands.executeCommand("setContext", "memblockCoverageHover.enabled", isEnabled());
}

function refreshFilterContext() {
  const active = symbolsViewFilter() !== "all";
  vscode.commands.executeCommand("setContext", "memblockCoverageHover.symbolsViewFiltered", active);
}


function updateStatusBar() {
  if (!statusBar) {
    return;
  }
  if (!isEnabled() || !getConfig().get("showStatusBar", false)) {
    statusBar.hide();
    return;
  }
  statusBar.text = `$(book) MemCov ${lastScanSummary.symbols}`;
  statusBar.tooltip = [
    "MemBlock Coverage Hover",
    `Files: ${lastScanSummary.files}`,
    `Symbols: ${lastScanSummary.symbols}`,
    `Aliases: ${lastScanSummary.aliases}`,
    `Filter: ${symbolsViewFilterLabel()}`,
    `Updated: ${lastScanSummary.updatedAt}`,
    "Click to search symbols."
  ].join("\n");
  statusBar.show();
}

function scheduleRescan() {
  if (scanTimer) {
    clearTimeout(scanTimer);
  }
  scanTimer = setTimeout(() => {
    scanTimer = undefined;
    rescanWorkspace(true);
  }, 700);
}

async function ensureDocumentIndexed(document) {
  const filePath = document.uri.fsPath;
  if (!isEnabled() || !isCoverageFile(filePath)) {
    return;
  }
  if (documentVersions.get(filePath) === document.version) {
    return;
  }
  if (pendingDocumentIndexes.has(filePath)) {
    return;
  }
  pendingDocumentIndexes.add(filePath);
  try {
    const docs = parseCoverageFile(document.getText(), filePath);
    replaceDocsForFile(filePath, docs, document.version);
  } finally {
    pendingDocumentIndexes.delete(filePath);
  }
}

function replaceDocsForFile(filePath, docs, version) {
  const fileDocs = mergeDuplicateDocs(docs);
  canonicalDocs = canonicalDocs.filter((doc) => doc.filePath !== filePath).concat(fileDocs);
  canonicalDocs.sort((a, b) => {
    const fileCmp = a.filePath.localeCompare(b.filePath);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    return a.line - b.line || a.name.localeCompare(b.name);
  });
  if (version !== undefined) {
    documentVersions.set(filePath, version);
  }
  rebuildSymbolIndex();
  refreshScanSummary();
  refreshRoleMapDiagnosticsForFile(filePath, fileDocs);
  treeProvider.refresh();
  if (glossaryProvider) {
    glossaryProvider.refresh();
  }
  updateStatusBar();
}

function invalidateFile(filePath) {
  documentVersions.delete(filePath);
  pendingDocumentIndexes.delete(filePath);
  canonicalDocs = canonicalDocs.filter((doc) => doc.filePath !== filePath);
  clearRoleMapDiagnosticsForFile(filePath);
  rebuildSymbolIndex();
  refreshScanSummary();
  treeProvider.refresh();
  if (glossaryProvider) {
    glossaryProvider.refresh();
  }
  updateStatusBar();
}

function invalidateSidecar(sidecarPath) {
  const filePath = coverageFileForSidecar(sidecarPath);
  if (filePath) {
    invalidateFile(filePath);
  } else {
    scheduleRescan();
  }
}

function refreshScanSummary() {
  const visibleDocs = publicDocs(canonicalDocs);
  const fileSet = new Set(visibleDocs.map((doc) => doc.filePath));
  lastScanSummary = {
    files: fileSet.size,
    symbols: visibleDocs.length,
    aliases: countAliases(),
    updatedAt: new Date().toLocaleString()
  };
}

async function rescanWorkspace(silent) {
  if (!isEnabled()) {
    canonicalDocs = [];
    symbolIndex = new Map();
    documentVersions = new Map();
    clearRoleMapDiagnostics();
    lastScanSummary = { files: 0, symbols: 0, aliases: 0, updatedAt: "disabled" };
    treeProvider.refresh();
    updateStatusBar();
    return;
  }

  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    return;
  }

  const cfg = getConfig();
  const includeGlobs = cfg.get("includeGlobs", ["**/coverage/memblock/**/*.sv"]);
  const excludeGlob = cfg.get("excludeGlob", "**/{.git,node_modules,tools/vscode-memblock-coverage-hover}/**");

  const uriByPath = new Map();
  for (const includeGlob of includeGlobs) {
    const found = await vscode.workspace.findFiles(includeGlob, excludeGlob);
    for (const uri of found) {
      uriByPath.set(uri.fsPath, uri);
    }
  }

  const docs = [];
  for (const uri of uriByPath.values()) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
      docs.push(...parseCoverageFile(text, uri.fsPath));
    } catch (err) {
      output.appendLine(`Failed to scan ${uri.fsPath}: ${err.message || err}`);
    }
  }

  canonicalDocs = mergeDuplicateDocs(docs);
  rebuildSymbolIndex();
  refreshScanSummary();
  refreshAllRoleMapDiagnostics();

  treeProvider.refresh();
  if (glossaryProvider) {
    glossaryProvider.refresh();
  }
  updateStatusBar();

  const msg = `MemBlock coverage hover loaded ${lastScanSummary.symbols} symbols from ${lastScanSummary.files} files`;
  output.appendLine(`${new Date().toISOString()} ${msg}`);
  if (!silent) {
    vscode.window.showInformationMessage(msg);
  }
}

function parseCoverageFile(text, filePath) {
  const lines = text.split(/\r?\n/);
  const roleMap = parseCovergroupRoleMap(lines);
  const manualDocs = parseAnnotationDocs(lines, filePath);
  manualDocs.push(...parseTestpointDocs(lines, filePath));
  manualDocs.push(...roleMapEntryDocs(roleMap, filePath));
  const autoDocs = [];
  if (getConfig().get("showAutoFallback", true)) {
    autoDocs.push(...parseAutoDocs(lines, filePath));
  }
  manualDocs.push(...parseSidecarDocsForFile(filePath));
  backfillOwnershipFromAuto(manualDocs, autoDocs);
  const docs = manualDocs.concat(autoDocs);
  applyCovergroupRoleMap(docs, roleMap);
  augmentDocsWithRelations(docs, lines);
  augmentDocsWithTestpointBackrefs(docs);
  augmentDocsWithDelayChains(docs);
  augmentDocsWithModules(docs);
  augmentDocsWithAutoMeanings(docs);
  return docs;
}

function parseCovergroupRoleMap(lines) {
  const roles = new Map();
  const entries = [];
  const duplicates = [];
  let inMap = false;
  let currentRole = "";
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const comment = rawLine.match(/^\s*\/\/\s*(.*?)\s*$/);
    if (!inMap) {
      if (comment && /^Covergroup\s+role\s+map\b/i.test(comment[1])) {
        inMap = true;
        startLine = i + 1;
      }
      continue;
    }

    if (!comment) {
      break;
    }

    const text = comment[1].trim();
    if (!text || /^[-]+$/.test(text)) {
      continue;
    }
    if (/^=+$/.test(text)) {
      break;
    }

    const role = text.match(/^(primary|secondary)\s*:\s*$/i);
    if (role) {
      currentRole = role[1].toLowerCase();
      continue;
    }

    const entry = text.match(/^(cg_[A-Za-z_][A-Za-z0-9_$]*)\s*(?:[-:]\s*(.+?))?\s*$/);
    if (entry && currentRole) {
      const name = entry[1];
      const mapped = {
        role: currentRole,
        detail: entry[2] ? entry[2].trim() : "",
        line: i + 1
      };
      entries.push({ name, ...mapped });
      if (roles.has(name)) {
        duplicates.push({ name, first: roles.get(name), duplicate: mapped });
      }
      roles.set(name, mapped);
    }
  }

  return { roles, entries, duplicates, startLine };
}

function applyCovergroupRoleMap(docs, roleMap) {
  const roles = roleMap.roles || new Map();
  if (roles.size === 0) {
    return;
  }
  for (const doc of docs) {
    if (doc.kind !== "covergroup") {
      continue;
    }
    const mapped = roles.get(doc.name);
    if (!mapped) {
      continue;
    }
    setField(doc, "role", mapped.role);
    if (mapped.detail) {
      setField(doc, "role-detail", mapped.detail);
    }
    setField(doc, "role-map-line", String(mapped.line));
  }
}


function roleMapEntryDocs(roleMap, filePath) {
  const docs = [];
  const entries = roleMap.entries || [];
  for (const mapped of entries) {
    const safeName = mapped.name.replace(/[^A-Za-z0-9_$]/g, "_");
    const doc = makeDoc(`covergroup_role_map_entry_${mapped.line}_${safeName}`, "meta", filePath, mapped.line, true);
    doc.sourceLine = mapped.name;
    addField(doc, "internal", "covergroup-role-map");
    addField(doc, "covergroup", mapped.name);
    addField(doc, "role", mapped.role);
    addField(doc, "role-map-line", String(mapped.line));
    if (mapped.detail) {
      addField(doc, "role-detail", mapped.detail);
    }
    docs.push(doc);
  }
  return docs;
}

function isInternalDoc(doc) {
  return firstField(doc, "internal") === "covergroup-role-map";
}

function publicDocs(docs) {
  return docs.filter((doc) => !isInternalDoc(doc));
}

function isRoleMapEntryDoc(doc) {
  return doc.kind === "meta" && firstField(doc, "internal") === "covergroup-role-map";
}

function roleMapEntryDocsFromDocs(docs) {
  return sortDocs(docs.filter(isRoleMapEntryDoc));
}

const TESTPOINT_CG_RELATION_RE = String.raw`direct(?:\s*(?:\/|\+)\s*proxy)?|proxy(?:\s*(?:\/|\+)\s*direct)?`;

function normalizeTestpointCgRelation(text) {
  const relation = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace("+", "/");
  return relation === "proxy/direct" ? "direct/proxy" : relation;
}

function parseAnnotationDocs(lines, filePath, options = {}) {
  const docs = [];
  let block = [];

  function flushBlock() {
    if (block.length === 0) {
      return;
    }
    const doc = buildAnnotationDoc(block, lines, filePath, options);
    if (doc) {
      docs.push(doc);
    }
    block = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const annotationText = annotationTextFromLine(trimmed, Boolean(options.sidecarPath));
    if (annotationText) {
      block.push({ text: annotationText, line: i + 1 });
    } else {
      flushBlock();
    }
  }
  flushBlock();
  return docs;
}

function annotationTextFromLine(trimmed, acceptBareAt) {
  if (/^\/\/\s*@/.test(trimmed)) {
    return trimmed.replace(/^\/\/\s*/, "");
  }
  if (acceptBareAt && /^@/.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function parseSidecarDocsForFile(filePath) {
  const docs = [];
  const preferredSidecars = sidecarPathsForCoverageFile(filePath);
  let hasPreferred = false;
  for (const sidecarPath of preferredSidecars) {
    if (!fs.existsSync(sidecarPath)) {
      continue;
    }
    hasPreferred = true;
    try {
      const text = fs.readFileSync(sidecarPath, "utf8");
      const lines = text.split(/\r?\n/);
      docs.push(...parseAnnotationDocs(lines, filePath, { sidecarPath }));
    } catch (err) {
      output.appendLine(`Failed to read sidecar ${sidecarPath}: ${err.message || err}`);
    }
  }
  if (!hasPreferred) {
    const legacyPath = legacyDocPathForCoverageFile(filePath);
    if (legacyPath && fs.existsSync(legacyPath)) {
      try {
        const text = fs.readFileSync(legacyPath, "utf8");
        docs.push(...parseLegacyMarkdownDocs(text, filePath, legacyPath));
      } catch (err) {
        output.appendLine(`Failed to read legacy doc ${legacyPath}: ${err.message || err}`);
      }
    }
  }
  return docs;
}

function parseLegacyMarkdownDocs(text, filePath, sidecarPath) {
  const docs = [];
  const lines = text.split(/\r?\n/);
  const title = legacyTitle(lines) || path.basename(filePath);
  const meta = makeDoc(path.basename(filePath, ".sv"), "meta", filePath, 1, false);
  meta.sidecarPath = sidecarPath;
  meta.fields.set("source", [`legacy doc ${relativePath(sidecarPath)}:1`]);
  addField(meta, "plain", `旧版人工文档摘要：${title}`);
  const summary = legacyBlockquoteSummary(lines);
  if (summary.location) {
    addField(meta, "excel", summary.location);
  }
  if (summary.core) {
    addField(meta, "meaning", summary.core);
  }
  if (summary.testpoints) {
    addField(meta, "testpoints", summary.testpoints);
  }
  addField(meta, "not-proof", "这是 doc/ fallback 摘要；若同名 hover_docs 存在，以 hover_docs 为准。");
  docs.push(meta);

  docs.push(...parseLegacyHeadingDocs(lines, filePath, sidecarPath));
  docs.push(...parseLegacySignalTableDocs(lines, filePath, sidecarPath));
  return docs;
}

function legacyTitle(lines) {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function legacyBlockquoteSummary(lines) {
  const summary = {};
  for (const line of lines.slice(0, 40)) {
    const match = line.match(/^>\s*\*\*(.+?)\*\*[:：]\s*(.+?)\s*$/u);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = stripMarkdownInline(match[2]);
    if (/章节定位/.test(key)) {
      summary.location = value;
    } else if (/测试点/.test(key)) {
      summary.testpoints = value;
    } else if (/核心问题/.test(key)) {
      summary.core = value;
    }
  }
  return summary;
}

function parseLegacyHeadingDocs(lines, filePath, sidecarPath) {
  const docs = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^#{2,4}\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?(?:\s+(.+?))?\s*$/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const kind = legacyKindForName(name);
    if (!kind) {
      continue;
    }
    const body = collectLegacySectionText(lines, i + 1);
    const doc = makeDoc(name, kind, filePath, i + 1, false);
    doc.sidecarPath = sidecarPath;
    doc.fields.set("source", [`legacy doc ${relativePath(sidecarPath)}:${i + 1}`]);
    const oneLine = firstUsefulLegacySentence(body);
    if (oneLine) {
      addField(doc, "plain", oneLine);
    }
    const bullets = legacyBullets(body).slice(0, 6);
    for (const bullet of bullets) {
      addField(doc, "meaning", bullet);
    }
    addField(doc, "not-proof", "来自 doc/ fallback。用于快速理解；精确反标以 SV Section 0 和 hover_docs 为准。");
    docs.push(doc);
  }
  return docs;
}

function legacyKindForName(name) {
  if (/^cg_/.test(name)) {
    return "covergroup";
  }
  if (/^cp_/.test(name)) {
    return "coverpoint";
  }
  if (/^(cx_|x_)/.test(name)) {
    return "cross";
  }
  return "";
}

function collectLegacySectionText(lines, startIndex) {
  const body = [];
  for (let i = startIndex; i < lines.length; i++) {
    if (/^#{1,4}\s+/.test(lines[i])) {
      break;
    }
    body.push(lines[i]);
  }
  return body.join("\n");
}

function firstUsefulLegacySentence(text) {
  const cleaned = String(text || "")
    .split(/\r?\n/)
    .map((line) => stripMarkdownInline(line.replace(/^[-*]\s*/, "")))
    .filter((line) => line && !/^\|/.test(line) && !/^---+$/.test(line));
  if (cleaned.length === 0) {
    return "";
  }
  return cleaned[0].slice(0, 220);
}

function legacyBullets(text) {
  const result = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (match) {
      result.push(stripMarkdownInline(match[1]));
    }
  }
  return result;
}

function parseLegacySignalTableDocs(lines, filePath, sidecarPath) {
  const docs = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const row = splitMarkdownTableRow(lines[i]);
    if (row.length < 3) {
      continue;
    }
    const nameMatch = row[0].match(/^`([A-Za-z_][A-Za-z0-9_$]*)`$/);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1];
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const doc = makeDoc(name, "signal", filePath, i + 1, false);
    doc.sidecarPath = sidecarPath;
    doc.fields.set("source", [`legacy doc ${relativePath(sidecarPath)}:${i + 1}`]);
    const pathCell = stripMarkdownInline(row[1]);
    const meaning = stripMarkdownInline(row.slice(2).join(" / "));
    if (meaning) {
      addField(doc, "plain", meaning);
    }
    if (/[`.]/.test(row[1]) || /PATH|io_|regOut|bits_/i.test(row[1])) {
      addField(doc, "rtl", pathCell);
    }
    addField(doc, "not-proof", "来自 doc/ fallback 的信号摘要；如果解释不够细，优先补 hover_docs。");
    docs.push(doc);
  }
  return docs;
}

function splitMarkdownTableRow(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("|") || !text.endsWith("|") || /^\|\s*-+/.test(text)) {
    return [];
  }
  return text.slice(1, -1).split("|").map((cell) => cell.trim());
}

function stripMarkdownInline(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTestpointDocs(lines, filePath) {
  const docs = [];
  let current = undefined;
  let inDirectory = false;

  function flushCurrent() {
    if (!current) {
      return;
    }
    const text = joinCommentFragments(current.testpointLines);
    if (text) {
      addField(current.doc, "plain", text);
    }
    for (const ref of current.covergroups) {
      addField(current.doc, "mapped-covergroups", `${ref.name} (${ref.relation}): ${ref.meaning}`);
    }
    docs.push(current.doc);
    current = undefined;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!inDirectory) {
      if (/^\s*\/\/\s*Section\s+0\b/u.test(rawLine)) {
        inDirectory = true;
      }
      continue;
    }

    if (!/^\s*\/\//.test(rawLine)) {
      flushCurrent();
      break;
    }

    const header = rawLine.match(/^\s*\/\/\s*(\d+(?:\.\d+){2,})\s+(.+?)\s*$/u);
    if (header) {
      flushCurrent();
      const id = header[1];
      const title = header[2].trim();
      const doc = makeDoc(`${id} ${title}`, "testpoint", filePath, i + 1, false);
      addField(doc, "testpoint-id", id);
      addField(doc, "meaning", title);
      addField(doc, "source", "testpoint directory comment");
      doc.aliases.add(id);
      current = {
        doc,
        testpointLines: [],
        covergroups: [],
        mode: ""
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const comment = rawLine.match(/^\s*\/\/(.*)$/);

    const text = comment[1].trim();
    if (!text) {
      continue;
    }

    const testpoint = text.match(/^测试点[:：]\s*(.*)$/u);
    if (testpoint) {
      current.mode = "testpoints";
      if (testpoint[1].trim()) {
        current.testpointLines.push(testpoint[1].trim());
      }
      continue;
    }

    if (/^对应\s*(?:cg|covergroup|covergroups)[:：]\s*$/iu.test(text)) {
      current.mode = "covergroups";
      continue;
    }

    const cg = text.match(new RegExp(`^(cg_[A-Za-z_][A-Za-z0-9_$]*)\\s+(${TESTPOINT_CG_RELATION_RE})\\s*:\\s*(.+?)\\s*$`, "iu"));
    if (cg) {
      current.mode = "covergroups";
      current.covergroups.push({
        name: cg[1],
        relation: normalizeTestpointCgRelation(cg[2]),
        meaning: cg[3].trim(),
        line: i + 1
      });
      continue;
    }

    if (current.mode === "testpoints") {
      current.testpointLines.push(text);
    }
  }

  flushCurrent();
  return docs;
}

function buildAnnotationDoc(block, lines, filePath, options = {}) {
  const first = block[0].text;
  const match = first.match(/^@([A-Za-z0-9_-]+)\s+(.+?)\s*$/);
  if (!match || !ANNO_KIND_MAP[match[1]]) {
    return undefined;
  }

  const kind = ANNO_KIND_MAP[match[1]];
  const name = sanitizeSymbolName(match[2]);
  const doc = makeDoc(name, kind, filePath, block[0].line, false);
  if (options.sidecarPath) {
    doc.sidecarPath = options.sidecarPath;
    doc.fields.set("source", [`sidecar ${relativePath(options.sidecarPath)}:${block[0].line}`]);
  } else {
    doc.fields.set("source", [`annotation ${match[1]}`]);
  }

  for (const item of block.slice(1)) {
    const m = item.text.match(/^@([A-Za-z0-9_-]+)\s+(.+?)\s*$/);
    if (!m) {
      continue;
    }
    addField(doc, m[1], m[2]);
  }

  const next = options.sidecarPath ? undefined : findNextCodeLine(lines, block[block.length - 1].line);
  if (next && kind !== "meta") {
    doc.sourceLine = next.text.trim();
    addField(doc, "decl", next.text.trim());
  }

  addAliasesFromField(doc, "alias");
  addAliasesFromField(doc, "rtl");
  return doc;
}

function backfillOwnershipFromAuto(manualDocs, autoDocs) {
  const autoByKindName = new Map();
  for (const doc of autoDocs) {
    const key = `${doc.filePath}:${doc.kind}:${doc.name}`;
    if (!autoByKindName.has(key)) {
      autoByKindName.set(key, []);
    }
    autoByKindName.get(key).push(doc);
  }

  for (const doc of manualDocs) {
    const candidates = autoByKindName.get(`${doc.filePath}:${doc.kind}:${doc.name}`) || [];
    if (candidates.length !== 1) {
      continue;
    }
    const auto = candidates[0];
    for (const key of ["covergroup", "coverpoint", "belongs-to"]) {
      if (!doc.fields.has(key) && auto.fields.has(key)) {
        for (const value of auto.fields.get(key)) {
          addField(doc, key, value);
        }
      }
    }
  }
}

function parseAutoDocs(lines, filePath) {
  const docs = [];
  let currentCovergroup = "";
  let currentCoverpoint = "";
  let currentCovergroupDoc = undefined;
  let currentCoverpointDoc = undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const code = stripLineComment(rawLine);
    if (!code.trim()) {
      continue;
    }

    let match = code.match(/^\s*covergroup\s+([A-Za-z_][A-Za-z0-9_$]*)\b/);
    if (match) {
      const doc = makeDoc(match[1], "covergroup", filePath, i + 1, true);
      addCommentSummary(doc, collectPrecedingComments(lines, i));
      addField(doc, "decl", rawLine.trim());
      docs.push(doc);
      currentCovergroup = match[1];
      currentCoverpoint = "";
      currentCovergroupDoc = doc;
      currentCoverpointDoc = undefined;
      continue;
    }

    const statement = collectStatement(lines, i);
    match = statement.code.match(/^\s*([A-Za-z_][A-Za-z0-9_$]*)\s*:\s*coverpoint\s+(.+?)(?:\s+iff\s*\((.*?)\))?\s*(?:\{|$)/);
    if (match) {
      const doc = makeDoc(match[1], "coverpoint", filePath, i + 1, true);
      addCommentSummary(doc, collectPrecedingComments(lines, i));
      addField(doc, "expr", match[2].trim());
      const bitOrder = bitOrderFromCoverpointExpr(match[2]);
      if (bitOrder) {
        addField(doc, "bit-order", bitOrder);
      }
      if (match[3]) {
        addField(doc, "sample", `iff (${match[3].trim()})`);
      }
      if (currentCovergroup) {
        addField(doc, "covergroup", currentCovergroup);
        addField(doc, "belongs-to", currentCovergroup);
        if (currentCovergroupDoc) {
          addField(currentCovergroupDoc, "coverpoints", match[1]);
        }
      }
      addField(doc, "decl", statement.text.trim());
      docs.push(doc);
      currentCoverpoint = match[1];
      currentCoverpointDoc = doc;
      continue;
    }

    match = statement.code.match(/^\s*([A-Za-z_][A-Za-z0-9_$]*)\s*:\s*cross\s+(.+?)(?:;|\{|$)/);
    if (match) {
      const doc = makeDoc(match[1], "cross", filePath, i + 1, true);
      addCommentSummary(doc, collectPrecedingComments(lines, i));
      addField(doc, "expr", match[2].trim());
      if (currentCovergroup) {
        addField(doc, "covergroup", currentCovergroup);
        addField(doc, "belongs-to", currentCovergroup);
      }
      addField(doc, "decl", statement.text.trim());
      docs.push(doc);
      if (/\bendgroup\b/.test(code)) {
        currentCovergroup = "";
        currentCoverpoint = "";
        currentCovergroupDoc = undefined;
        currentCoverpointDoc = undefined;
      }
      continue;
    }

    const binRegex = /\b(ignore_bins|bins)\s+([A-Za-z_][A-Za-z0-9_$]*)(?:\s*\[[^\]]+\])?/g;
    let binMatch;
    while ((binMatch = binRegex.exec(code)) !== null) {
      const doc = makeDoc(binMatch[2], "bin", filePath, i + 1, true);
      addCommentSummary(doc, collectPrecedingComments(lines, i));
      addField(doc, "decl", rawLine.trim());
      addField(doc, "bin-kind", binMatch[1] === "ignore_bins" ? "ignore_bins：忽略项，不计入目标覆盖" : "bins：目标覆盖项");
      if (currentCovergroup) {
        addField(doc, "covergroup", currentCovergroup);
        addField(doc, "belongs-to", currentCovergroup);
      }
      const expr = extractAssignmentExpression(code.slice(binMatch.index));
      if (expr) {
        addField(doc, "expr", expr);
        addField(doc, "value", expr);
      }
      if (currentCoverpoint) {
        addField(doc, "coverpoint", currentCoverpoint);
        addField(doc, "belongs-to", currentCoverpoint);
        if (currentCoverpointDoc) {
          addField(currentCoverpointDoc, "bins", binMatch[2]);
          const bitExplain = explainBinValueWithBitOrder(expr, firstField(currentCoverpointDoc, "bit-order"));
          if (bitExplain) {
            addField(doc, "bit-order", bitExplain);
          }
        }
      }
      if (!doc.fields.has("meaning")) {
        addField(doc, "meaning", autoBinMeaning(binMatch[2], currentCoverpoint, expr, binMatch[1]));
      }
      docs.push(doc);
    }

    if (currentCoverpoint && isCoverpointCloseLine(code)) {
      currentCoverpoint = "";
      currentCoverpointDoc = undefined;
    }
    if (/\bendgroup\b/.test(code)) {
      currentCovergroup = "";
      currentCoverpoint = "";
      currentCovergroupDoc = undefined;
      currentCoverpointDoc = undefined;
    }

    const declDocs = parseSignalDecl(statement.code, statement.text, lines, i, filePath);
    docs.push(...declDocs);
  }

  return docs;
}

function isCoverpointCloseLine(code) {
  return /^\s*\}\s*;?\s*$/.test(code);
}

function parseSignalDecl(code, rawLine, lines, lineIndex, filePath) {
  const docs = [];
  const trimmed = code.trim();
  if (!/^(wire|reg|logic)\b/.test(trimmed) || !trimmed.endsWith(";")) {
    return docs;
  }

  const match = trimmed.match(/^(wire|reg|logic)\s+(?:automatic\s+)?(?:signed\s+)?(?:\[[^\]]+\]\s*)?(.+);$/);
  if (!match) {
    return docs;
  }

  const declKind = match[1];
  const body = match[2];
  const pieces = splitTopLevelCommas(body);
  const comments = collectPrecedingComments(lines, lineIndex);

  for (const piece of pieces) {
    const m = piece.trim().match(/^([A-Za-z_][A-Za-z0-9_$]*)(?:\s*=\s*(.+))?$/);
    if (!m) {
      continue;
    }
    const name = m[1];
    const expr = m[2] ? m[2].trim() : "";
    const doc = makeDoc(name, "signal", filePath, lineIndex + 1, true);
    addCommentSummary(doc, comments);
    addField(doc, "decl", rawLine.trim());
    addField(doc, "kind", declKind);
    if (expr) {
      addField(doc, "expr", expr);
      for (const alias of extractPathAliases(expr)) {
        if (alias !== name) {
          doc.aliases.add(alias);
        }
      }
    }
    docs.push(doc);
  }

  return docs;
}

function makeDoc(name, kind, filePath, line, auto) {
  return {
    name,
    kind,
    filePath,
    line,
    definitionLine: 0,
    auto,
    fields: new Map(),
    aliases: new Set(),
    sidecarPath: "",
    sourceLine: ""
  };
}

function addField(doc, key, value) {
  const normalized = key.trim();
  const text = String(value || "").trim();
  if (!normalized || !text) {
    return;
  }
  if (!doc.fields.has(normalized)) {
    doc.fields.set(normalized, []);
  }
  const values = doc.fields.get(normalized);
  if (!values.includes(text)) {
    values.push(text);
  }
}

function prependField(doc, key, value) {
  const normalized = key.trim();
  const text = String(value || "").trim();
  if (!normalized || !text) {
    return;
  }
  if (!doc.fields.has(normalized)) {
    doc.fields.set(normalized, []);
  }
  const values = doc.fields.get(normalized);
  const index = values.indexOf(text);
  if (index >= 0) {
    values.splice(index, 1);
  }
  values.unshift(text);
}

function setField(doc, key, value) {
  const normalized = key.trim();
  const text = String(value || "").trim();
  if (!normalized || !text) {
    return;
  }
  doc.fields.set(normalized, [text]);
}

function addCommentSummary(doc, comments) {
  if (comments.length === 0) {
    return;
  }
  if (comments.some((line) => /[-=]{4,}/.test(line))) {
    return;
  }
  const cleaned = comments.map((line) => line.replace(/[-=]{4,}/g, "").trim());
  if (cleaned.some((line) => isSectionComment(line))) {
    return;
  }
  const compact = cleaned
    .filter((line) => !isStructuralComment(line))
    .filter(Boolean)
    .join(" ");
  if (compact) {
    addField(doc, "meaning", compact);
  }
}

function isSectionComment(line) {
  const text = String(line || "").trim();
  return (
    /^\d+(?:\.\d+)+\s+/.test(text) ||
    /^Section\b/i.test(text) ||
    /^覆盖[:：]/.test(text)
  );
}

function isStructuralComment(line) {
  const text = String(line || "").trim();
  return (
    !text ||
    isSectionComment(text) ||
    /^[-=]+$/.test(text)
  );
}

function addAliasesFromField(doc, key) {
  const values = doc.fields.get(key) || [];
  for (const value of values) {
    if (key === "alias") {
      for (const part of value.split(/[,\s]+/)) {
        const alias = sanitizeSymbolName(part);
        if (alias && alias !== doc.name) {
          doc.aliases.add(alias);
        }
      }
    } else {
      for (const alias of extractPathAliases(value)) {
        if (alias !== doc.name) {
          doc.aliases.add(alias);
        }
      }
    }
  }
}

function mergeDuplicateDocs(docs) {
  const byKey = new Map();
  for (const doc of docs) {
    const key = docMergeKey(doc);
    if (!byKey.has(key)) {
      byKey.set(key, doc);
      continue;
    }
    const existing = byKey.get(key);
    mergeDoc(existing, doc);
  }

  const merged = [...byKey.values()];
  merged.sort((a, b) => {
    const fileCmp = a.filePath.localeCompare(b.filePath);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    return a.line - b.line || a.name.localeCompare(b.name);
  });
  return merged;
}

function docMergeKey(doc) {
  if (doc.kind === "bin") {
    const covergroup = firstField(doc, "covergroup");
    const coverpoint = firstField(doc, "coverpoint") || firstField(doc, "belongs-to");
    return `${doc.filePath}:${doc.kind}:${covergroup}:${coverpoint}:${doc.name}`;
  }
  if (doc.kind === "cross" || doc.kind === "coverpoint") {
    const covergroup = firstField(doc, "covergroup") || firstField(doc, "belongs-to");
    return `${doc.filePath}:${doc.kind}:${covergroup}:${doc.name}`;
  }
  return `${doc.filePath}:${doc.kind}:${doc.name}`;
}

function mergeDoc(target, source) {
  const targetWasAuto = target.auto;
  target.auto = target.auto && source.auto;
  if (!target.definitionLine && source.definitionLine) {
    target.definitionLine = source.definitionLine;
  }
  if (target.sidecarPath && !source.sidecarPath && source.line) {
    target.line = source.line;
    target.sourceLine = source.sourceLine || firstField(source, "decl") || target.sourceLine;
    if (!target.definitionLine && source.definitionLine) {
      target.definitionLine = source.definitionLine;
    }
  }
  if (!target.sidecarPath && source.sidecarPath) {
    target.sidecarPath = source.sidecarPath;
  }
  if (!target.sourceLine && source.sourceLine) {
    target.sourceLine = source.sourceLine;
  }
  for (const alias of source.aliases) {
    target.aliases.add(alias);
  }
  for (const [key, values] of source.fields.entries()) {
    for (const value of values) {
      if (!source.auto && targetWasAuto) {
        prependField(target, key, value);
      } else {
        addField(target, key, value);
      }
    }
  }
}

function autoBinMeaning(name, coverpoint, expr, binKeyword = "bins") {
  const cp = coverpoint || "当前 coverpoint";
  if (binKeyword === "ignore_bins") {
    return `${name} 是 ${cp} 的忽略项；命中时不计入目标覆盖。`;
  }
  if (String(expr || "").trim() === "default") {
    return `${name} 是 ${cp} 中未被其它 bins/ignore_bins 列出的采样组合。`;
  }
  return `bin ${name} 属于 ${cp}。`;
}

function bitOrderFromCoverpointExpr(expr) {
  const text = String(expr || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}") || !hasBalancedDelimiters(text)) {
    return "";
  }
  const inner = text.slice(1, -1);
  const items = splitTopLevelCommas(inner).map((item) => item.trim()).filter(Boolean);
  if (items.length < 2) {
    return "";
  }
  return items.map((item, index) => `bit[${items.length - 1 - index}]=${item}`).join(", ");
}

function explainBinValueWithBitOrder(valueExpr, bitOrderText) {
  const order = parseBitOrder(bitOrderText);
  if (order.length === 0) {
    return "";
  }
  const bits = singleBinaryLiteralBits(valueExpr);
  if (!bits || bits.length !== order.length) {
    return "";
  }
  const active = [];
  for (let i = 0; i < bits.length; i++) {
    const signal = order[i].signal;
    if (bits[i] === "1") {
      active.push(signal);
    }
  }
  if (active.length === 0) {
    return `该 bin 对应全部为 0；bit 顺序：${bitOrderText}`;
  }
  return `该 bin 置 1：${active.join(", ")}；bit 顺序：${bitOrderText}`;
}

function parseBitOrder(text) {
  const result = [];
  const regex = /bit\[(\d+)\]=([^,]+)/g;
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) {
    result.push({ index: Number(match[1]), signal: match[2].trim() });
  }
  return result.sort((a, b) => b.index - a.index);
}

function singleBinaryLiteralBits(expr) {
  const text = String(expr || "").trim();
  const match = text.match(/^\{\s*(\d+)'b([01_xzXZ]+)\s*\}$/);
  if (!match) {
    return "";
  }
  const width = Number(match[1]);
  const bits = match[2].replace(/_/g, "");
  return bits.length === width ? bits : "";
}

function rebuildSymbolIndex() {
  symbolIndex = new Map();
  for (const doc of publicDocs(canonicalDocs)) {
    addIndexEntry(doc.name, doc);
    for (const alias of doc.aliases) {
      addIndexEntry(alias, doc);
    }
  }
}

function addIndexEntry(symbol, doc) {
  if (!symbol || symbol.length < 2) {
    return;
  }
  if (!symbolIndex.has(symbol)) {
    symbolIndex.set(symbol, []);
  }
  symbolIndex.get(symbol).push(doc);
}

function chooseBestDocForHover(symbol, document, position) {
  const docs = symbolIndex.get(symbol) || [];
  if (docs.length === 0) {
    return undefined;
  }
  const filePath = document.uri.fsPath;
  const line = position.line + 1;
  const sameFile = docs.filter((doc) => doc.filePath === filePath);
  const candidates = sameFile.length > 0 ? sameFile : docs;
  candidates.sort((a, b) => {
    if (a.auto !== b.auto) {
      return a.auto ? 1 : -1;
    }
    const aDist = Math.abs(a.line - line);
    const bDist = Math.abs(b.line - line);
    if (aDist !== bDist) {
      return aDist - bDist;
    }
    return kindRank(a.kind) - kindRank(b.kind);
  });
  return candidates[0];
}

function bestDefinitionDoc(symbol, filePath, oneBasedLine) {
  const docs = symbolIndex.get(symbol) || [];
  if (docs.length === 0) {
    return undefined;
  }
  const sameFile = docs.filter((doc) => doc.filePath === filePath);
  const candidates = sameFile.length > 0 ? sameFile : docs;
  candidates.sort((a, b) => {
    const rankDiff = definitionRank(a) - definitionRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const aDist = Math.abs(docOpenLine(a) - oneBasedLine);
    const bDist = Math.abs(docOpenLine(b) - oneBasedLine);
    if (aDist !== bDist) {
      return aDist - bDist;
    }
    if (a.auto !== b.auto) {
      return a.auto ? -1 : 1;
    }
    return kindRank(a.kind) - kindRank(b.kind);
  });
  return candidates[0];
}

function definitionRank(doc) {
  if (!doc.sidecarPath && doc.kind === "signal") {
    return 0;
  }
  if (!doc.sidecarPath && ["coverpoint", "bin", "cross", "covergroup"].includes(doc.kind)) {
    return 1;
  }
  if (doc.kind === "signal") {
    return 2;
  }
  return 3;
}

function bestSignalDoc(symbol, filePath) {
  const docs = symbolIndex.get(symbol) || [];
  const signalDocs = docs.filter((doc) => doc.kind === "signal");
  if (signalDocs.length === 0) {
    return undefined;
  }
  const sameFile = signalDocs.filter((doc) => doc.filePath === filePath);
  const candidates = sameFile.length > 0 ? sameFile : signalDocs;
  candidates.sort((a, b) => definitionRank(a) - definitionRank(b) || docOpenLine(a) - docOpenLine(b));
  return candidates[0];
}

function kindRank(kind) {
  const index = KIND_ORDER.indexOf(kind);
  return index >= 0 ? index : KIND_ORDER.length;
}

function countAliases() {
  let count = 0;
  for (const doc of canonicalDocs) {
    count += doc.aliases.size;
  }
  return count;
}

function augmentDocsWithRelations(docs, lines) {
  const docsByName = new Map();
  for (const doc of docs) {
    if (!docsByName.has(doc.name)) {
      docsByName.set(doc.name, []);
    }
    docsByName.get(doc.name).push(doc);
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex];
    const code = stripLineComment(rawLine).trim();
    if (!code) {
      continue;
    }
    const assign = code.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s*(<=|=)\s*(.+?);$/);
    if (!assign) {
      continue;
    }
    const lhs = assign[1];
    const rhs = assign[3].trim();
    for (const doc of signalDocs(docsByName, lhs)) {
      doc.definitionLine = lineIndex + 1;
      const relation = /_n+$/.test(lhs) ? "delayed-from" : "driven-by";
      addField(doc, relation, rhs);
      if (relation === "delayed-from") {
        addField(doc, "sample-relation", `${lhs} <= ${rhs} @posedge clock`);
      }
    }
    for (const token of extractIdentifiers(rhs)) {
      for (const doc of signalDocs(docsByName, token)) {
        addField(doc, "used-by", `drives ${lhs}`);
      }
    }
  }

  for (const doc of docs) {
    if (!["coverpoint", "cross", "bin"].includes(doc.kind)) {
      continue;
    }
    const values = []
      .concat(doc.fields.get("expr") || [])
      .concat(doc.fields.get("sample") || [])
      .concat(doc.fields.get("decl") || []);
    for (const value of values) {
      for (const token of extractIdentifiers(value)) {
        if (token === doc.name) {
          continue;
        }
        for (const signalDoc of signalDocs(docsByName, token)) {
          addField(signalDoc, "used-by", `${doc.kind} ${doc.name}`);
        }
      }
    }
  }
}

function augmentDocsWithTestpointBackrefs(docs) {
  const covergroupsByFileName = new Map();
  for (const doc of docs) {
    if (doc.kind !== "covergroup") {
      continue;
    }
    const key = `${doc.filePath}:${doc.name}`;
    if (!covergroupsByFileName.has(key)) {
      covergroupsByFileName.set(key, []);
    }
    covergroupsByFileName.get(key).push(doc);
  }

  for (const testpoint of docs) {
    if (testpoint.kind !== "testpoint") {
      continue;
    }
    const id = firstField(testpoint, "testpoint-id") || testpoint.name;
    const title = firstField(testpoint, "meaning") || testpoint.name;
    for (const ref of testpointCgRefs(testpoint)) {
      const targets = covergroupsByFileName.get(`${testpoint.filePath}:${ref.name}`) || [];
      for (const covergroup of targets) {
        addField(covergroup, "testpoints", `${id} ${title} (${ref.relation}): ${ref.meaning}`);
      }
    }
  }
}

function augmentDocsWithDelayChains(docs) {
  const docsByName = new Map();
  for (const doc of docs) {
    if (!docsByName.has(doc.name)) {
      docsByName.set(doc.name, []);
    }
    docsByName.get(doc.name).push(doc);
  }

  const resolving = new Set();
  const resolved = new Map();

  function resolve(doc) {
    if (resolved.has(doc)) {
      return resolved.get(doc);
    }
    if (resolving.has(doc)) {
      return { cycles: 0, root: "" };
    }
    resolving.add(doc);

    const sourceText = firstField(doc, "delayed-from");
    const sourceName = singleIdentifier(sourceText);
    let result;
    if (!sourceText) {
      result = { cycles: 0, root: "" };
    } else if (sourceName) {
      const sourceDoc = signalDocs(docsByName, sourceName)[0];
      if (sourceDoc) {
        const sourceInfo = resolve(sourceDoc);
        result = {
          cycles: sourceInfo.cycles + 1,
          root: sourceInfo.root || sourceName
        };
      } else {
        result = { cycles: 1, root: sourceName };
      }
    } else {
      result = { cycles: 1, root: "" };
    }

    resolving.delete(doc);
    resolved.set(doc, result);
    return result;
  }

  for (const doc of docs) {
    if (doc.kind !== "signal" || !doc.fields.has("delayed-from")) {
      continue;
    }
    const info = resolve(doc);
    if (info.cycles > 0) {
      setField(doc, "delay-cycles", `${info.cycles} 拍`);
    }
    if (info.cycles > 1 && info.root) {
      setField(doc, "root-source", info.root);
    }
  }
}

function singleIdentifier(text) {
  const trimmed = String(text || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed) ? trimmed : "";
}

function augmentDocsWithModules(docs) {
  const docsByName = new Map();
  for (const doc of docs) {
    if (!docsByName.has(doc.name)) {
      docsByName.set(doc.name, []);
    }
    docsByName.get(doc.name).push(doc);
  }

  for (const doc of docs) {
    if (doc.fields.has("module")) {
      continue;
    }
    const moduleName = inferModuleFromDoc(doc);
    if (moduleName) {
      addField(doc, "module", moduleName);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    for (const doc of docs) {
      if (doc.kind !== "signal" || doc.fields.has("module")) {
        continue;
      }
      const sourceModule = inferModuleFromRelatedSignals(doc, docsByName);
      if (sourceModule) {
        addField(doc, "module", sourceModule);
      }
    }
  }
}

function augmentDocsWithAutoMeanings(docs) {
  for (const doc of docs) {
    if (doc.fields.has("plain") || doc.fields.has("meaning")) {
      continue;
    }
    const meaning = autoMeaningForDoc(doc);
    if (meaning) {
      addField(doc, doc.kind === "signal" ? "auto-note" : "meaning", meaning);
    }
  }
}

function autoMeaningForDoc(doc) {
  if (doc.kind === "signal") {
    return autoSignalMeaning(doc);
  }
  if (doc.kind === "covergroup") {
    return "功能覆盖率分组，里面组织一组相关 coverpoint/cross。";
  }
  if (doc.kind === "coverpoint") {
    return "功能覆盖采样点，用来把一个信号/表达式按 bins 分类统计。";
  }
  if (doc.kind === "cross") {
    return "交叉覆盖，统计多个 coverpoint 的组合是否出现。";
  }
  return "";
}

function autoSignalMeaning(doc) {
  const name = doc.name;
  const expr = firstField(doc, "expr");
  const rtl = firstField(doc, "rtl");
  const delayedFrom = firstField(doc, "delayed-from");
  const moduleName = firstField(doc, "module");

  if (delayedFrom) {
    return `${delayedFrom} 的延迟采样版本，用来和后级 coverage 观察窗口对齐。`;
  }
  if (rtl || /`[A-Za-z0-9_$]+_PATH\./.test(expr)) {
    const moduleText = moduleName ? `${moduleName} 的 ` : "";
    return `${moduleText}${name}，是从 RTL 层级路径引出的 coverage 观察信号。`;
  }
  if (/_window\b/.test(name)) {
    return `${name} 是组合观察窗口，用来把多个相关事件合成一个 coverage 条件。`;
  }
  if (/_bucket\b/.test(name)) {
    return `${name} 是分桶编码，用于把连续/宽范围值压成少量 coverage bins。`;
  }
  if (/_key\b/.test(name)) {
    return `${name} 是组合 key，用于 coverpoint 分类。`;
  }
  if (expr) {
    return `${name} 由表达式组合得到，用作 coverage helper 信号。`;
  }
  return `${name} 是 coverage 中自动识别到的信号。`;
}

function inferModuleFromDoc(doc) {
  const texts = []
    .concat(doc.fields.get("rtl") || [])
    .concat(doc.fields.get("decl") || [])
    .concat(doc.fields.get("expr") || []);
  if (doc.sourceLine) {
    texts.push(doc.sourceLine);
  }
  return inferModuleFromText(texts.join(" "));
}

function inferModuleFromRelatedSignals(doc, docsByName) {
  const relationTexts = []
    .concat(doc.fields.get("delayed-from") || [])
    .concat(doc.fields.get("driven-by") || []);
  for (const text of relationTexts) {
    for (const token of extractIdentifiers(text)) {
      for (const related of signalDocs(docsByName, token)) {
        const moduleName = firstField(related, "module");
        if (moduleName) {
          return moduleName;
        }
      }
    }
  }
  return "";
}

function inferModuleFromText(text) {
  for (const [regex, moduleName] of MODULE_PATTERNS) {
    if (regex.test(text)) {
      return moduleName;
    }
  }

  const inner = String(text || "").match(/\binner_([A-Za-z0-9_]+)/);
  if (inner) {
    return formatInferredModuleName(inner[1]);
  }
  return "";
}

function formatInferredModuleName(rawName) {
  const known = {
    dcache: "DCache",
    lsu: "LSU",
    mmu: "MMU",
    pmp: "PMP",
    sbuffer: "SBuffer",
    uncache: "Uncache"
  };
  const key = String(rawName || "").toLowerCase();
  if (known[key]) {
    return known[key];
  }
  return String(rawName || "")
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\s+/g, "_");
}

function signalDocs(docsByName, name) {
  return (docsByName.get(name) || []).filter((doc) => doc.kind === "signal");
}

function extractIdentifiers(text) {
  const skip = new Set([
    "automatic", "begin", "bins", "bit", "case", "covergroup", "coverpoint",
    "cross", "default", "else", "end", "endcase", "endfunction", "endgroup",
    "function", "if", "iff", "input", "integer", "logic", "localparam",
    "output", "reg", "return", "signed", "wire"
  ]);
  const result = new Set();
  const regex = /\b[A-Za-z_][A-Za-z0-9_$]*\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    if (!skip.has(token)) {
      result.add(token);
    }
  }
  return [...result];
}

class MemBlockHoverProvider {
  async provideHover(document, position) {
    if (!isEnabled() || !isCoverageFile(document.uri.fsPath)) {
      return undefined;
    }

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_$]*/);
    if (!range) {
      return undefined;
    }

    const word = document.getText(range);
    await ensureDocumentIndexed(document);
    const doc = chooseBestDocForHover(word, document, position);
    if (!doc) {
      return undefined;
    }

    if (doc.auto && !getConfig().get("showAutoFallback", true)) {
      return undefined;
    }

    return new vscode.Hover(renderHoverMarkdown(doc, word), range);
  }
}

class MemBlockDefinitionProvider {
  async provideDefinition(document, position) {
    if (!isEnabled() || !isCoverageFile(document.uri.fsPath)) {
      return undefined;
    }

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_$]*/);
    if (!range) {
      return undefined;
    }

    const word = document.getText(range);
    await ensureDocumentIndexed(document);
    const doc = bestDefinitionDoc(word, document.uri.fsPath, position.line + 1);
    if (!doc) {
      return undefined;
    }

    const uri = vscode.Uri.file(docOpenPath(doc));
    const zeroBasedLine = Math.max(docOpenLine(doc) - 1, 0);
    const targetRange = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);
    return new vscode.Location(uri, targetRange);
  }
}

function renderHoverMarkdown(doc, hoveredWord) {
  const cfg = getConfig();
  const maxFields = cfg.get("maxHoverFields", 18);
  const detailLevel = cfg.get("hoverDetailLevel", "compact");
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportHtml = false;

  const aliasNote =
    detailLevel !== "compact" && hoveredWord !== doc.name
      ? ` _(alias of \`${escapeCode(doc.name)}\`)_`
      : "";
  md.appendMarkdown(`### \`${escapeCode(doc.name)}\`${aliasNote}\n\n`);
  md.appendMarkdown(`**类型**：${KIND_LABELS[doc.kind] || doc.kind}`);
  if (doc.auto) {
    md.appendMarkdown(" · 自动推断");
  }
  md.appendMarkdown("\n\n");
  if (doc.fields.has("module")) {
    md.appendMarkdown(`**所属模块**：${inlineCode(firstField(doc, "module"))}\n\n`);
  }

  const preferred = [
    "plain",
    "meaning",
    "background",
    "when",
    "auto-note",
    "example",
    "why",
    "related-signals",
    "testpoint-id",
    "mapped-covergroups",
    "testpoints",
    "covergroup",
    "coverpoint",
    "belongs-to",
    "expr",
    "rtl",
    "delayed-from",
    "delay-cycles",
    "sample-relation",
    "driven-by",
    "stage",
    "sample",
    "excel",
    "excel-category",
    "secondary-category",
    "backref-kind",
    "used-by",
    "used",
    "coverpoints",
    "bins",
    "value",
    "waveform",
    "debug-miss",
    "debug",
    "not-proof",
    "decl",
    "kind",
    "source"
  ];

  if (detailLevel !== "compact" && doc.auto && doc.kind === "signal" && !doc.fields.has("plain") && !doc.fields.has("meaning")) {
    md.appendMarkdown("**含义**：暂无人工解释；下面的自动说明只说明结构/来源，不代表完整硬件语义。\n\n");
  }

  if (detailLevel === "compact") {
    renderCompactFields(md, doc);
    renderRelatedSignals(md, doc);
    return md;
  }

  const printed = new Set(doc.fields.has("module") ? ["module"] : []);
  let fieldCount = 0;
  for (const key of preferred) {
    if (fieldCount >= maxFields) {
      break;
    }
    if (doc.fields.has(key)) {
      appendField(md, key, doc.fields.get(key));
      printed.add(key);
      fieldCount++;
    }
  }

  for (const [key, values] of doc.fields.entries()) {
    if (fieldCount >= maxFields) {
      break;
    }
    if (!printed.has(key)) {
      appendField(md, key, values);
      fieldCount++;
    }
  }

  if (doc.aliases.size > 0 && fieldCount < maxFields) {
    const aliases = [...doc.aliases].slice(0, 12).map((item) => `\`${escapeCode(item)}\``).join(", ");
    md.appendMarkdown(`**可 hover 别名**：${aliases}`);
    if (doc.aliases.size > 12) {
      md.appendMarkdown(`, ... +${doc.aliases.size - 12}`);
    }
    md.appendMarkdown("\n\n");
  }

  if (cfg.get("showSourceLocation", true)) {
    md.appendMarkdown(`---\n`);
    md.appendMarkdown(`\`${docLocationLabel(doc)}\`\n\n`);
  }

  renderRelatedSignals(md, doc);

  return md;
}

function renderCompactFields(md, doc) {
  const meaning = compactMeaning(doc);
  if (meaning) {
    md.appendMarkdown(`**含义**：${escapeMd(meaning)}\n\n`);
  } else if (doc.kind === "signal" && doc.auto && doc.fields.has("auto-note")) {
    md.appendMarkdown("**含义**：暂无人工解释\n\n");
  }

  if (doc.kind === "signal" && doc.fields.has("auto-note")) {
    appendField(md, "auto-note", [firstField(doc, "auto-note")]);
  }

  if (doc.kind === "bin") {
    if (doc.fields.has("bin-kind")) {
      appendField(md, "bin-kind", [firstField(doc, "bin-kind")]);
    }
    if (doc.fields.has("coverpoint")) {
      appendField(md, "coverpoint", [firstField(doc, "coverpoint")]);
    }
    if (doc.fields.has("covergroup")) {
      appendField(md, "covergroup", [firstField(doc, "covergroup")]);
    }
    if (doc.fields.has("value")) {
      appendField(md, "value", [firstField(doc, "value")]);
    } else if (doc.fields.has("expr")) {
      appendField(md, "value", [firstField(doc, "expr")]);
    }
    if (doc.fields.has("bit-order")) {
      appendField(md, "bit-order", [firstField(doc, "bit-order")]);
    }
    return;
  }

  if (doc.kind === "testpoint") {
    if (doc.fields.has("testpoint-id")) {
      appendField(md, "testpoint-id", [firstField(doc, "testpoint-id")]);
    }
    const mapped = doc.fields.get("mapped-covergroups") || [];
    if (mapped.length > 0) {
      appendField(md, "mapped-covergroups", mapped.slice(0, 8));
    }
    return;
  }

  if (doc.fields.has("rtl")) {
    appendField(md, "rtl", [firstField(doc, "rtl")]);
  } else if (doc.fields.has("sample-relation")) {
    appendField(md, "sample-relation", [firstField(doc, "sample-relation")]);
  } else if (doc.fields.has("expr") && isUsefulCompactExpression(firstField(doc, "expr"))) {
    appendField(md, "expr", [firstField(doc, "expr")]);
  } else if (doc.fields.has("sample")) {
    appendField(md, "sample", [firstField(doc, "sample")]);
  }

  if (doc.fields.has("delayed-from")) {
    appendField(md, "delayed-from", [firstField(doc, "delayed-from")]);
    if (doc.fields.has("root-source")) {
      appendField(md, "root-source", [firstField(doc, "root-source")]);
    }
    if (doc.fields.has("delay-cycles")) {
      appendField(md, "delay-cycles", [firstField(doc, "delay-cycles")]);
    }
  } else if (doc.fields.has("driven-by")) {
    appendField(md, "driven-by", [firstField(doc, "driven-by")]);
  }

  if ((doc.kind === "coverpoint" || doc.kind === "cross") && doc.fields.has("covergroup")) {
    if (doc.kind === "coverpoint" && doc.fields.has("bit-order")) {
      appendField(md, "bit-order", [firstField(doc, "bit-order")]);
    }
    appendField(md, "covergroup", [firstField(doc, "covergroup")]);
    return;
  }

  if (doc.kind !== "signal" && doc.fields.has("belongs-to")) {
    appendField(md, "belongs-to", [firstField(doc, "belongs-to")]);
  }
}

function renderRelatedSignals(md, doc) {
  const cfg = getConfig();
  if (!cfg.get("showRelatedSignals", true)) {
    return;
  }
  if (!["signal", "coverpoint", "cross", "bin"].includes(doc.kind)) {
    return;
  }
  const maxRelated = cfg.get("maxRelatedSignals", 8);
  const related = relatedSignalDocs(doc).slice(0, maxRelated);
  if (related.length === 0) {
    return;
  }
  const clickable = cfg.get("relatedSignalsClickable", true);
  const labels = related.map((signalDoc) => (
    clickable
      ? fileLinkForDoc(signalDoc, signalDoc.name)
      : inlineCode(signalDoc.name)
  ));
  md.appendMarkdown(`**相关信号**：${labels.join(" · ")}\n\n`);
}

function relatedSignalDocs(doc) {
  const texts = relationTextsForRelatedSignals(doc);
  const names = new Set();
  for (const text of texts) {
    for (const token of extractIdentifiers(text)) {
      if (token !== doc.name) {
        names.add(token);
      }
    }
  }

  const result = [];
  const seen = new Set();
  for (const name of names) {
    const signalDoc = bestSignalDoc(name, doc.filePath);
    if (!signalDoc || signalDoc.name === doc.name || seen.has(signalDoc.name)) {
      continue;
    }
    seen.add(signalDoc.name);
    result.push(signalDoc);
  }
  return sortDocs(result);
}

function relationTextsForRelatedSignals(doc) {
  const texts = []
    .concat(doc.fields.get("expr") || [])
    .concat(doc.fields.get("sample") || [])
    .concat(doc.fields.get("sample-relation") || [])
    .concat(doc.fields.get("delayed-from") || [])
    .concat(doc.fields.get("driven-by") || []);

  if (texts.length === 0) {
    texts.push(...(doc.fields.get("decl") || []));
  }

  return texts;
}

function fileLinkForDoc(doc, label) {
  const uri = vscode.Uri.file(docOpenPath(doc)).with({ fragment: `L${docOpenLine(doc)}` }).toString();
  return `[${inlineCode(label || doc.name)}](${uri})`;
}

function compactMeaning(doc) {
  const plain = firstField(doc, "plain");
  const meaning = firstField(doc, "meaning");
  if (plain && meaning && plain !== meaning) {
    if (plain.includes(meaning)) {
      return plain;
    }
    if (meaning.includes(plain)) {
      return meaning;
    }
    return `${trimSentenceEnd(plain)}；${meaning}`;
  }
  return plain || meaning;
}

function isUsefulCompactExpression(expr) {
  const text = String(expr || "").trim();
  if (!text) {
    return false;
  }
  if (/[({[,]\s*$/.test(text)) {
    return false;
  }
  return hasBalancedDelimiters(text);
}

function hasBalancedDelimiters(text) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (const ch of String(text || "")) {
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) {
        return false;
      }
    }
  }
  return stack.length === 0;
}

function trimSentenceEnd(text) {
  return String(text || "").replace(/[。；;.\s]+$/u, "");
}

function appendField(md, key, values) {
  const label = FIELD_LABELS[key] || key;
  const list = Array.isArray(values) ? values : [values];
  if (list.length > 1 && key === "mapped-covergroups") {
    md.appendMarkdown(`**${label}**：\n`);
    for (const value of list) {
      md.appendMarkdown(`- ${escapeMd(formatFieldValue(key, value))}\n`);
    }
    md.appendMarkdown("\n");
    return;
  }
  const joined = formatFieldValue(key, list.join("; "));
  if (CODE_FIELD_KEYS.has(key)) {
    md.appendMarkdown(`**${label}**：${inlineCode(joined)}\n\n`);
  } else {
    md.appendMarkdown(`**${label}**：${escapeMd(joined)}\n\n`);
  }
}

function formatFieldValue(key, value) {
  const text = String(value || "");
  return text;
}

class GlossaryProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  refresh() {
    this._onDidChange.fire(vscode.Uri.parse("memblock-hover-glossary:/MemBlockCoverageGlossary.md"));
  }

  provideTextDocumentContent() {
    return buildGlossaryMarkdown();
  }
}

function buildGlossaryMarkdown() {
  const lines = [];
  lines.push("# MemBlock Coverage Hover Glossary");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push(`Files: ${lastScanSummary.files}`);
  lines.push(`Symbols: ${lastScanSummary.symbols}`);
  lines.push(`Aliases: ${lastScanSummary.aliases}`);
  lines.push("");

  for (const kind of KIND_ORDER) {
    const group = canonicalDocs.filter((doc) => doc.kind === kind);
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${KIND_LABELS[kind] || kind} (${group.length})`);
    lines.push("");
    for (const doc of group) {
      const meaning = firstField(doc, "meaning") || firstField(doc, "expr") || firstField(doc, "decl") || "";
      lines.push(`- \`${doc.name}\` - ${meaning}`);
      lines.push(`  - ${docLocationLabel(doc)}`);
      if (doc.aliases.size > 0) {
        lines.push(`  - aliases: ${[...doc.aliases].slice(0, 20).map((x) => `\`${x}\``).join(", ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function openGlossary() {
  const uri = vscode.Uri.parse("memblock-hover-glossary:/MemBlockCoverageGlossary.md");
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function searchSymbol() {
  if (canonicalDocs.length === 0) {
    await rescanWorkspace(true);
  }

  const items = publicDocs(canonicalDocs).map((doc) => {
    const meaning = firstField(doc, "meaning") || firstField(doc, "expr") || firstField(doc, "decl") || "";
    return {
      label: doc.name,
      description: `${KIND_LABELS[doc.kind] || doc.kind} · ${docLocationLabel(doc)}`,
      detail: meaning,
      doc
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: "MemBlock Coverage Hover Symbols",
    placeHolder: "Search testpoint / signal / covergroup / coverpoint / bin / cross",
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!picked) {
    return;
  }
  await openDocLocation(picked.doc);
}

async function openDocLocation(doc) {
  await openPathLocation(docOpenPath(doc), docOpenLine(doc));
}

async function openPathLocation(filePath, oneBasedLine) {
  const uri = vscode.Uri.file(filePath);
  const textDoc = await vscode.workspace.openTextDocument(uri);
  const lineIndex = clampLineIndex(textDoc, oneBasedLine);
  const line = textDoc.lineAt(lineIndex);
  const range = line.range;
  const editor = await vscode.window.showTextDocument(textDoc, {
    preview: true,
    selection: new vscode.Selection(range.start, range.end)
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  flashLine(editor, lineIndex);
}

async function toggleEnable() {
  const cfg = getConfig();
  const next = !cfg.get("enable", true);
  await cfg.update("enable", next, vscode.ConfigurationTarget.Workspace);
  refreshEnabledContext();
  refreshFilterContext();
  updateStatusBar();
  if (next) {
    await rescanWorkspace(false);
  } else {
    vscode.window.showInformationMessage("MemBlock Coverage Hover disabled for this workspace.");
  }
}

async function filterSymbolsView() {
  const current = symbolsViewFilter();
  const items = SYMBOLS_VIEW_FILTER_OPTIONS.map((option) => ({
    label: option.label,
    description: option.value === current ? "current" : option.value,
    detail: option.detail,
    picked: option.value === current,
    value: option.value
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "MemBlock Coverage Symbols Filter",
    placeHolder: "Choose what the Symbols tree should show",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) {
    return;
  }
  await getConfig().update("symbolsViewFilter", picked.value, vscode.ConfigurationTarget.Workspace);
  refreshFilterContext();
  updateStatusBar();
  if (treeProvider) {
    treeProvider.refresh();
  }
}

async function resetSymbolsViewFilter() {
  await getConfig().update("symbolsViewFilter", "all", vscode.ConfigurationTarget.Workspace);
  refreshFilterContext();
  updateStatusBar();
  if (treeProvider) {
    treeProvider.refresh();
  }
}

async function validateRoleMap() {
  const filePath = activeCoverageFilePath();
  if (!filePath) {
    vscode.window.showInformationMessage("Open a MemBlock coverage .sv file before validating its role map.");
    return;
  }
  let docs = docsForFile(filePath);
  if (docs.length === 0) {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.fsPath === filePath) {
      await ensureDocumentIndexed(editor.document);
      docs = docsForFile(filePath);
    }
  }
  const diagnostics = roleMapDiagnostics(filePath, docs);
  refreshRoleMapDiagnosticsForFile(filePath, docs);
  const lines = roleMapDiagnosticLines(filePath, diagnostics);
  output.show(true);
  output.appendLine(lines.join("\n"));
  const summary = roleMapSummaryText(diagnostics);
  const severity = diagnostics.missingTargets.length || diagnostics.duplicates.length ? "Warning" : "Information";
  const action = await vscode.window[`show${severity}Message`](summary, "Show Details", "Open Role Map");
  if (action === "Show Details") {
    output.show(true);
  } else if (action === "Open Role Map" && diagnostics.startLine) {
    await openPathLocation(filePath, diagnostics.startLine);
  }
}

class SymbolTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    if (element.type === "empty") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description || "";
      item.tooltip = element.tooltip || element.label;
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    if (element.type === "roleWarning") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description || "";
      item.tooltip = element.tooltip || element.label;
      item.iconPath = new vscode.ThemeIcon("warning");
      item.contextValue = "memblockCoverageRoleWarning";
      if (element.filePath && element.line) {
        item.command = openLocationCommand(element.filePath, element.line);
      }
      return item;
    }

    if (element.type === "filterState") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description || "";
      item.tooltip = element.tooltip || element.label;
      item.iconPath = new vscode.ThemeIcon("filter");
      item.contextValue = "memblockCoverageFilterState";
      item.command = { command: "memblockCoverageHover.filterSymbolsView", title: "Change Symbols Filter" };
      return item;
    }

    if (element.type === "workspace") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${element.files.length} files`;
      item.tooltip = "已经扫描过的其它 MemBlock coverage 文件。";
      item.iconPath = new vscode.ThemeIcon("library");
      item.contextValue = "memblockCoverageWorkspace";
      return item;
    }

    if (element.type === "file") {
      const item = new vscode.TreeItem(
        element.label,
        element.current ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
      );
      const filter = symbolsViewFilter();
      const diagnostics = roleMapDiagnostics(element.filePath, element.docs);
      const publicCount = publicDocs(element.docs).length;
      const roleSummary = roleMapSummaryText(diagnostics);
      item.description = filter === "all" ? `${publicCount} symbols` : `${symbolsViewFilterLabel(filter)} · ${roleSummary}`;
      item.tooltip = `${relativePath(element.filePath)}\n${fileCountSummary(element.docs)}\nRole map: ${roleSummary}\nFilter: ${symbolsViewFilterLabel(filter)}`;
      item.iconPath = new vscode.ThemeIcon(element.current ? "file-code" : "file");
      item.contextValue = "memblockCoverageFile";
      item.command = openLocationCommand(element.filePath, 1);
      return item;
    }

    if (element.type === "section") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(element.docs.length);
      item.tooltip = element.tooltip || `${element.label}: ${element.docs.length}`;
      item.iconPath = new vscode.ThemeIcon(element.icon || "list-tree");
      item.contextValue = "memblockCoverageSection";
      return item;
    }

    if (element.type === "testpoint") {
      const refs = filteredTestpointRefs(element.doc, element.fileDocs);
      const item = new vscode.TreeItem(element.doc.name, refs.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = refs.length > 0 ? `${refs.length} cg` : shortDescription(element.doc);
      item.tooltip = treeTooltipForDoc(element.doc);
      item.iconPath = new vscode.ThemeIcon("checklist");
      item.contextValue = "memblockCoverageTestpoint";
      item.command = openDocCommand(element.doc);
      return item;
    }

    if (element.type === "covergroupRef") {
      const item = new vscode.TreeItem(element.ref.name, vscode.TreeItemCollapsibleState.None);
      const role = covergroupRole(element.target);
      const prefix = role ? `${role} · ` : "";
      item.description = `${prefix}${element.ref.relation}: ${truncateText(element.ref.meaning, 44)}`;
      item.tooltip = treeTooltipForCovergroupRef(element.ref, element.doc, element.target);
      item.iconPath = new vscode.ThemeIcon(element.target ? "symbol-namespace" : "warning");
      item.contextValue = "memblockCoverageCovergroupRef";
      item.command = element.target ? openDocCommand(element.target) : openDocCommand(element.doc);
      return item;
    }

    if (element.type === "signalCategory") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(element.docs.length);
      item.tooltip = element.tooltip || `${element.label}: ${element.docs.length}`;
      item.iconPath = new vscode.ThemeIcon(element.icon || "symbol-variable");
      item.contextValue = "memblockCoverageSignalCategory";
      return item;
    }

    if (element.type === "covergroup") {
      const counts = covergroupCounts(element.fileDocs, element.doc);
      const item = new vscode.TreeItem(element.doc.name, vscode.TreeItemCollapsibleState.Collapsed);
      const role = covergroupRole(element.doc);
      const prefix = role ? `${role} · ` : "unclassified · ";
      item.description = `${prefix}${counts.coverpoints} cp · ${counts.bins} bins · ${counts.crosses} cross`;
      item.tooltip = treeTooltipForDoc(element.doc);
      item.iconPath = new vscode.ThemeIcon("symbol-namespace");
      item.contextValue = "memblockCoverageCovergroup";
      item.command = openDocCommand(element.doc);
      return item;
    }

    if (element.type === "coverpoint") {
      const bins = binsForCoverpoint(element.fileDocs, element.doc);
      const item = new vscode.TreeItem(element.doc.name, bins.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = bins.length > 0 ? `${bins.length} bins` : shortDescription(element.doc);
      item.tooltip = treeTooltipForDoc(element.doc);
      item.iconPath = new vscode.ThemeIcon("symbol-field");
      item.contextValue = "memblockCoverageCoverpoint";
      item.command = openDocCommand(element.doc);
      return item;
    }

    if (element.type === "doc") {
      const item = new vscode.TreeItem(element.doc.name, vscode.TreeItemCollapsibleState.None);
      item.description = docTreeDescription(element.doc);
      item.tooltip = treeTooltipForDoc(element.doc);
      item.iconPath = new vscode.ThemeIcon(iconForKind(element.doc.kind));
      item.command = openDocCommand(element.doc);
      item.contextValue = `memblockCoverage${capitalizeKind(element.doc.kind)}`;
      return item;
    }

    const item = new vscode.TreeItem(String(element.label || ""), vscode.TreeItemCollapsibleState.None);
    return item;
  }

  getChildren(element) {
    if (!element) {
      indexActiveCoverageDocumentInBackground();
      return rootTreeNodes();
    }

    if (element.type === "workspace") {
      return element.files.map((filePath) => fileNode(filePath, docsForFile(filePath), false));
    }

    if (element.type === "file") {
      return fileSectionNodes(element.filePath, element.docs);
    }

    if (element.type === "section") {
      if (element.section === "testpoints") {
        return sortDocs(element.docs).map((doc) => ({
          type: "testpoint",
          doc,
          fileDocs: docsForFile(element.filePath)
        }));
      }
      if (element.section === "signals") {
        return signalCategoryNodes(element.filePath, element.docs);
      }
      if (element.section === "covergroups") {
        return sortDocs(element.docs).map((doc) => ({
          type: "covergroup",
          doc,
          fileDocs: docsForFile(element.filePath)
        }));
      }
      return sortDocs(element.docs).map((doc) => ({ type: "doc", doc }));
    }

    if (element.type === "testpoint") {
      return testpointCovergroupRefNodes(element.doc, element.fileDocs);
    }

    if (element.type === "signalCategory") {
      return sortDocs(element.docs).map((doc) => ({ type: "doc", doc }));
    }

    if (element.type === "covergroup") {
      return covergroupChildNodes(element.fileDocs, element.doc);
    }

    if (element.type === "coverpoint") {
      return binsForCoverpoint(element.fileDocs, element.doc).map((doc) => ({ type: "doc", doc }));
    }

    return [];
  }
}

function indexActiveCoverageDocumentInBackground() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const editorPath = editor.document.uri.fsPath;
  if (!isCoverageFile(editorPath)) {
    const sidecarTarget = coverageFileForSidecar(editorPath);
    if (sidecarTarget && docsForFile(sidecarTarget).length === 0 && !pendingDocumentIndexes.has(sidecarTarget)) {
      vscode.workspace.openTextDocument(vscode.Uri.file(sidecarTarget))
        .then((doc) => ensureDocumentIndexed(doc))
        .catch((err) => output.appendLine(`Failed to index sidecar target ${sidecarTarget}: ${err.message || err}`));
    }
    return;
  }
  const filePath = editorPath;
  if (documentVersions.get(filePath) === editor.document.version || pendingDocumentIndexes.has(filePath)) {
    return;
  }
  ensureDocumentIndexed(editor.document).catch((err) => {
    output.appendLine(`Failed to index active document ${filePath}: ${err.message || err}`);
  });
}

function rootTreeNodes() {
  if (!isEnabled()) {
    return [{ type: "empty", label: "MemBlock Coverage Hover is disabled", description: "enable it first" }];
  }

  const activeFilePath = activeCoverageFilePath();
  const files = sortedIndexedFiles();
  const nodes = [];
  const filter = symbolsViewFilter();

  if (filter !== "all") {
    nodes.push({
      type: "filterState",
      label: `Filter: ${symbolsViewFilterLabel(filter)}`,
      description: "click to change",
      tooltip: "Symbols view is filtered. Use the filter button or Reset Filter to show all symbols."
    });
  }

  if (activeFilePath) {
    const activeDocs = docsForFile(activeFilePath);
    if (activeDocs.length > 0) {
      nodes.push(fileNode(activeFilePath, activeDocs, true));
    } else {
      nodes.push({
        type: "empty",
        label: `Current: ${path.basename(activeFilePath)}`,
        description: "no symbols yet",
        tooltip: "当前文件还没有被解析到符号；保存、hover 一次，或运行 Rescan Symbols。"
      });
    }
  }

  const otherFiles = files.filter((filePath) => filePath !== activeFilePath);
  if (otherFiles.length > 0 && filter === "all") {
    nodes.push({ type: "workspace", label: "Other Scanned Files", files: otherFiles });
  }

  if (nodes.length === 0) {
    nodes.push({
      type: "empty",
      label: "Open a MemBlock coverage .sv file",
      description: "or run Rescan Symbols",
      tooltip: "打开 coverage/memblock/**/*.sv 后，这里会显示当前文件的信号、covergroup、coverpoint、bin 和 cross 目录。"
    });
  }

  return nodes;
}

function fileNode(filePath, docs, current) {
  return {
    type: "file",
    filePath,
    docs,
    current,
    label: `${current ? "Current: " : ""}${path.basename(filePath)}`
  };
}

function fileSectionNodes(filePath, docs) {
  const filter = symbolsViewFilter();
  const show = (section) => symbolsViewShowsSection(filter, section);
  const testpointsAll = docs.filter((doc) => doc.kind === "testpoint");
  const signals = docs.filter((doc) => doc.kind === "signal");
  const covergroupsAll = docs.filter((doc) => doc.kind === "covergroup");
  const testpoints = filterTestpointDocs(testpointsAll, filePath, docs, filter);
  const covergroups = filterCovergroupDocs(covergroupsAll, filter);
  const diagnostics = roleMapDiagnostics(filePath, docs);
  const orphanCoverpoints = docs.filter((doc) => doc.kind === "coverpoint" && !firstField(doc, "covergroup"));
  const orphanBins = docs.filter((doc) => doc.kind === "bin" && !firstField(doc, "coverpoint"));
  const orphanCrosses = docs.filter((doc) => doc.kind === "cross" && !firstField(doc, "covergroup"));
  const meta = docs.filter((doc) => doc.kind === "meta" && !isInternalDoc(doc));
  const unknown = docs.filter((doc) => !["testpoint", "signal", "covergroup", "coverpoint", "bin", "cross", "meta"].includes(doc.kind));

  const sections = [];
  if (shouldShowRoleWarnings(filter)) {
    for (const warning of roleWarningNodes(filePath, diagnostics)) {
      sections.push(warning);
    }
  }
  if (show("testpoints") && testpoints.length > 0) {
    sections.push({
      type: "section",
      section: "testpoints",
      filePath,
      label: "Testpoints",
      docs: testpoints,
      icon: "checklist",
      tooltip: "Section 0 反标目录里的测试点大类；展开后查看它指向的 direct/proxy covergroup。"
    });
  }
  if (show("signals") && signals.length > 0) {
    sections.push({
      type: "section",
      section: "signals",
      filePath,
      label: "Signals",
      docs: signals,
      icon: "symbol-variable",
      tooltip: "本文件里用于采样、组合窗口、打一拍窗口、RTL alias 的信号列表。"
    });
  }
  if (show("covergroups") && covergroups.length > 0) {
    sections.push({
      type: "section",
      section: "covergroups",
      filePath,
      label: "Covergroups",
      docs: covergroups,
      icon: "symbol-namespace",
      tooltip: "按 covergroup 展开，再看其中的 coverpoint、bin 和 cross。"
    });
  }
  if (show("looseCoverpoints") && orphanCoverpoints.length > 0) {
    sections.push({
      type: "section",
      section: "looseCoverpoints",
      filePath,
      label: "Loose Coverpoints",
      docs: orphanCoverpoints,
      icon: "symbol-field",
      tooltip: "没有解析到所属 covergroup 的 coverpoint。"
    });
  }
  if (show("looseBins") && orphanBins.length > 0) {
    sections.push({
      type: "section",
      section: "looseBins",
      filePath,
      label: "Loose Bins",
      docs: orphanBins,
      icon: "symbol-enum-member",
      tooltip: "没有解析到所属 coverpoint 的 bin。"
    });
  }
  if (show("looseCrosses") && orphanCrosses.length > 0) {
    sections.push({
      type: "section",
      section: "looseCrosses",
      filePath,
      label: "Loose Crosses",
      docs: orphanCrosses,
      icon: "symbol-operator",
      tooltip: "没有解析到所属 covergroup 的 cross。"
    });
  }
  if (show("meta") && meta.length > 0) {
    sections.push({
      type: "section",
      section: "meta",
      filePath,
      label: "Concepts / Meta",
      docs: meta,
      icon: "symbol-misc",
      tooltip: "概念解释，例如 SBuffer、LoadUnit 等学习入口。"
    });
  }
  if (show("unknown") && unknown.length > 0) {
    sections.push({
      type: "section",
      section: "unknown",
      filePath,
      label: "Other Symbols",
      docs: unknown,
      icon: "symbol-misc"
    });
  }
  if (!sections.some((section) => section.type === "section") && filter !== "all") {
    sections.push({
      type: "empty",
      label: emptyFilterLabel(filter, diagnostics),
      description: "change filter",
      tooltip: emptyFilterTooltip(filter, diagnostics)
    });
  }
  return sections;
}

function shouldShowRoleWarnings(filter) {
  return ["all", "primary", "secondary", "unclassified", "covergroups"].includes(filter);
}

function symbolsViewShowsSection(filter, section) {
  const sections = SYMBOLS_VIEW_FILTER_SECTIONS[filter] || SYMBOLS_VIEW_FILTER_SECTIONS.all;
  return sections.has(section);
}

function isRoleFilter(filter) {
  return filter === "primary" || filter === "secondary" || filter === "unclassified";
}

function covergroupRole(doc) {
  if (!doc) {
    return "";
  }
  const explicit = firstField(doc, "role");
  if (!explicit) {
    return "";
  }
  const match = explicit.match(/\b(primary|secondary)\b/i);
  return match ? match[1].toLowerCase() : "";
}

function covergroupMatchesRole(doc, filter) {
  if (!isRoleFilter(filter)) {
    return true;
  }
  const role = covergroupRole(doc);
  if (filter === "unclassified") {
    return !role;
  }
  return role === filter;
}

function filterCovergroupDocs(covergroups, filter = symbolsViewFilter()) {
  if (!isRoleFilter(filter)) {
    return covergroups;
  }
  return covergroups.filter((doc) => covergroupMatchesRole(doc, filter));
}

function filterTestpointDocs(testpoints, filePath, fileDocs, filter = symbolsViewFilter()) {
  if (!isRoleFilter(filter) || filter === "unclassified") {
    return filter === "unclassified" ? [] : testpoints;
  }
  return testpoints.filter((doc) => filteredTestpointRefs(doc, fileDocs, filter).length > 0);
}

function roleMapDiagnostics(filePath, docs) {
  const covergroups = docs.filter((doc) => doc.kind === "covergroup");
  const byName = new Map(covergroups.map((doc) => [doc.name, doc]));
  const primary = covergroups.filter((doc) => covergroupRole(doc) === "primary");
  const secondary = covergroups.filter((doc) => covergroupRole(doc) === "secondary");
  const unclassified = covergroups.filter((doc) => !covergroupRole(doc));
  const roleEntries = [];
  const missingTargets = [];
  const duplicatePairs = [];
  const startLine = covergroupRoleMapStartLine(docs);

  for (const [name, docsForName] of groupRoleDocsByName(docs).entries()) {
    for (const doc of docsForName) {
      const role = covergroupRole(doc);
      if (role) {
        roleEntries.push({ name, role, line: Number(firstField(doc, "role-map-line") || 0), doc });
      }
    }
  }

  const rawRoleMap = activeRoleMapForDocs(docs);
  for (const entry of rawRoleMap.entries) {
    if (!byName.has(entry.name)) {
      missingTargets.push(entry);
    }
  }
  duplicatePairs.push(...rawRoleMap.duplicates);

  return {
    filePath,
    covergroups,
    primary,
    secondary,
    unclassified,
    roleEntries,
    missingTargets,
    duplicates: duplicatePairs,
    startLine
  };
}

function groupRoleDocsByName(docs) {
  const result = new Map();
  for (const doc of docs) {
    if (doc.kind !== "covergroup") {
      continue;
    }
    if (!result.has(doc.name)) {
      result.set(doc.name, []);
    }
    result.get(doc.name).push(doc);
  }
  return result;
}

function activeRoleMapForDocs(docs) {
  const result = { entries: [], duplicates: [] };
  const roleDocs = roleMapEntryDocsFromDocs(docs);
  for (const doc of roleDocs) {
    result.entries.push({
      name: firstField(doc, "covergroup") || doc.sourceLine || doc.name,
      role: firstField(doc, "role") || "",
      detail: firstField(doc, "role-detail") || "",
      line: doc.line
    });
  }
  const seen = new Map();
  for (const entry of result.entries) {
    if (seen.has(entry.name)) {
      result.duplicates.push({ name: entry.name, first: seen.get(entry.name), duplicate: entry });
    } else {
      seen.set(entry.name, entry);
    }
  }
  return result;
}

function covergroupRoleMapStartLine(docs) {
  const roleDocs = roleMapEntryDocsFromDocs(docs);
  if (roleDocs.length === 0) {
    return 0;
  }
  return Math.min(...roleDocs.map((doc) => doc.line));
}

function roleMapSummaryText(diagnostics) {
  const warn = diagnostics.missingTargets.length + diagnostics.duplicates.length;
  const suffix = warn ? ` · ${warn} warning${warn === 1 ? "" : "s"}` : "";
  return `${diagnostics.primary.length} primary · ${diagnostics.secondary.length} secondary · ${diagnostics.unclassified.length} unclassified${suffix}`;
}

function roleWarningNodes(filePath, diagnostics) {
  const nodes = [];
  for (const item of diagnostics.missingTargets) {
    nodes.push({
      type: "roleWarning",
      filePath,
      line: item.line,
      label: `Role map target not found: ${item.name}`,
      description: item.role,
      tooltip: `Covergroup role map lists ${item.name}, but no matching covergroup declaration was indexed.`
    });
  }
  for (const item of diagnostics.duplicates) {
    nodes.push({
      type: "roleWarning",
      filePath,
      line: item.duplicate.line,
      label: `Duplicate role map entry: ${item.name}`,
      description: item.duplicate.role,
      tooltip: `First entry at line ${item.first.line}; duplicate at line ${item.duplicate.line}.`
    });
  }
  return nodes;
}

function emptyFilterLabel(filter, diagnostics) {
  if (filter === "primary") {
    return diagnostics.covergroups.length === 0
      ? "No covergroups indexed yet"
      : "No primary covergroups found";
  }
  if (filter === "secondary") {
    return diagnostics.covergroups.length === 0
      ? "No covergroups indexed yet"
      : "No secondary covergroups found";
  }
  if (filter === "unclassified") {
    return "No unclassified covergroups";
  }
  return `No symbols match ${symbolsViewFilterLabel(filter)}`;
}

function emptyFilterTooltip(filter, diagnostics) {
  if (filter === "primary" || filter === "secondary") {
    return diagnostics.startLine
      ? "Check Covergroup role map entries or run Rescan Symbols."
      : "No Covergroup role map was indexed for this file. Add one or run Rescan Symbols after editing.";
  }
  return "Use the filter button in the view title to show another symbol set.";
}

function roleMapDiagnosticLines(filePath, diagnostics) {
  const lines = [];
  lines.push("");
  lines.push(`MemBlock Coverage Role Map: ${relativePath(filePath)}`);
  lines.push(roleMapSummaryText(diagnostics));
  if (diagnostics.startLine) {
    lines.push(`role map starts near line ${diagnostics.startLine}`);
  } else {
    lines.push("role map not found");
  }
  if (diagnostics.missingTargets.length > 0) {
    lines.push("missing targets:");
    for (const item of diagnostics.missingTargets) {
      lines.push(`  line ${item.line}: ${item.name} (${item.role})`);
    }
  }
  if (diagnostics.duplicates.length > 0) {
    lines.push("duplicate entries:");
    for (const item of diagnostics.duplicates) {
      lines.push(`  ${item.name}: first line ${item.first.line}, duplicate line ${item.duplicate.line}`);
    }
  }
  if (diagnostics.unclassified.length > 0) {
    lines.push("unclassified covergroups:");
    for (const doc of diagnostics.unclassified) {
      lines.push(`  line ${doc.line}: ${doc.name}`);
    }
  }
  if (diagnostics.missingTargets.length === 0 && diagnostics.duplicates.length === 0 && diagnostics.unclassified.length === 0) {
    lines.push("role map looks complete.");
  }
  return lines;
}

function refreshAllRoleMapDiagnostics() {
  if (!roleDiagnosticCollection) {
    return;
  }
  roleDiagnosticCollection.clear();
  for (const filePath of sortedIndexedFiles()) {
    refreshRoleMapDiagnosticsForFile(filePath, docsForFile(filePath));
  }
}

function refreshRoleMapDiagnosticsForFile(filePath, docs) {
  if (!roleDiagnosticCollection || !filePath) {
    return;
  }
  const diagnostics = roleMapDiagnostics(filePath, docs);
  const items = roleMapProblemDiagnostics(diagnostics);
  roleDiagnosticCollection.set(vscode.Uri.file(filePath), items);
}

function clearRoleMapDiagnostics() {
  if (roleDiagnosticCollection) {
    roleDiagnosticCollection.clear();
  }
}

function clearRoleMapDiagnosticsForFile(filePath) {
  if (roleDiagnosticCollection && filePath) {
    roleDiagnosticCollection.delete(vscode.Uri.file(filePath));
  }
}

function roleMapProblemDiagnostics(diagnostics) {
  const items = [];
  for (const item of diagnostics.missingTargets) {
    items.push(makeRoleMapDiagnostic(
      item.line,
      `Covergroup role map target not found: ${item.name}`,
      vscode.DiagnosticSeverity.Warning,
      "missing-covergroup"
    ));
  }
  for (const item of diagnostics.duplicates) {
    items.push(makeRoleMapDiagnostic(
      item.duplicate.line,
      `Duplicate covergroup role map entry: ${item.name}`,
      vscode.DiagnosticSeverity.Warning,
      "duplicate-covergroup"
    ));
  }
  return items;
}

function makeRoleMapDiagnostic(oneBasedLine, message, severity, code) {
  const line = Math.max(Number(oneBasedLine || 1) - 1, 0);
  const range = new vscode.Range(line, 0, line, 200);
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = "MemBlock Coverage Role Map";
  diagnostic.code = code;
  return diagnostic;
}

function signalCategoryNodes(filePath, signalDocsList) {
  const categories = [
    {
      key: "rtl",
      label: "RTL Aliases",
      icon: "references",
      tooltip: "直接 alias 到 RTL 层级路径的信号，适合从 coverage 反查真实硬件信号。",
      docs: []
    },
    {
      key: "delayed",
      label: "Delayed / Sampled",
      icon: "history",
      tooltip: "由时钟打一拍或多拍得到的观察窗口，例如 *_n、*_nn。",
      docs: []
    },
    {
      key: "window",
      label: "Derived Windows",
      icon: "watch",
      tooltip: "为了覆盖率组合出来的事件窗口，例如 *_window。",
      docs: []
    },
    {
      key: "helper",
      label: "Helper Signals",
      icon: "symbol-property",
      tooltip: "组合辅助信号、编码 key、bucket 等 coverage helper。",
      docs: []
    },
    {
      key: "other",
      label: "Other Signals",
      icon: "symbol-variable",
      tooltip: "其它自动解析到的 signal。",
      docs: []
    }
  ];
  const byKey = new Map(categories.map((item) => [item.key, item]));

  for (const doc of signalDocsList) {
    byKey.get(signalCategory(doc)).docs.push(doc);
  }

  return categories
    .filter((category) => category.docs.length > 0)
    .map((category) => ({
      type: "signalCategory",
      filePath,
      label: category.label,
      docs: category.docs,
      icon: category.icon,
      tooltip: category.tooltip
    }));
}

function signalCategory(doc) {
  if (doc.fields.has("rtl")) {
    return "rtl";
  }
  if (doc.fields.has("delayed-from") || /_n+$/.test(doc.name)) {
    return "delayed";
  }
  if (/_window\b/.test(doc.name)) {
    return "window";
  }
  if (doc.fields.has("driven-by") || doc.fields.has("expr")) {
    return "helper";
  }
  return "other";
}

function covergroupChildNodes(fileDocs, covergroupDoc) {
  const coverpoints = coverpointsForCovergroup(fileDocs, covergroupDoc);
  const crosses = crossesForCovergroup(fileDocs, covergroupDoc);
  const looseBins = fileDocs.filter((doc) =>
    doc.kind === "bin" &&
    firstField(doc, "covergroup") === covergroupDoc.name &&
    !firstField(doc, "coverpoint")
  );
  const nodes = [];
  for (const doc of coverpoints) {
    nodes.push({ type: "coverpoint", doc, fileDocs });
  }
  for (const doc of crosses) {
    nodes.push({ type: "doc", doc });
  }
  for (const doc of looseBins) {
    nodes.push({ type: "doc", doc });
  }
  return nodes;
}

function covergroupCounts(fileDocs, covergroupDoc) {
  const coverpoints = coverpointsForCovergroup(fileDocs, covergroupDoc);
  const crosses = crossesForCovergroup(fileDocs, covergroupDoc);
  const bins = fileDocs.filter((doc) => doc.kind === "bin" && firstField(doc, "covergroup") === covergroupDoc.name);
  return {
    coverpoints: coverpoints.length,
    crosses: crosses.length,
    bins: bins.length
  };
}

function coverpointsForCovergroup(fileDocs, covergroupDoc) {
  return sortDocs(fileDocs.filter((doc) =>
    doc.kind === "coverpoint" &&
    firstField(doc, "covergroup") === covergroupDoc.name
  ));
}

function crossesForCovergroup(fileDocs, covergroupDoc) {
  return sortDocs(fileDocs.filter((doc) =>
    doc.kind === "cross" &&
    firstField(doc, "covergroup") === covergroupDoc.name
  ));
}

function binsForCoverpoint(fileDocs, coverpointDoc) {
  const covergroup = firstField(coverpointDoc, "covergroup");
  return sortDocs(fileDocs.filter((doc) =>
    doc.kind === "bin" &&
    firstField(doc, "coverpoint") === coverpointDoc.name &&
    (!covergroup || firstField(doc, "covergroup") === covergroup)
  ));
}

function testpointCovergroupRefNodes(testpointDoc, fileDocs) {
  return filteredTestpointRefs(testpointDoc, fileDocs).map((ref) => ({
    type: "covergroupRef",
    doc: testpointDoc,
    ref,
    target: bestCovergroupDoc(ref.name, testpointDoc.filePath, fileDocs)
  }));
}

function filteredTestpointRefs(testpointDoc, fileDocs, filter = symbolsViewFilter()) {
  const refs = testpointCgRefs(testpointDoc);
  if (!isRoleFilter(filter)) {
    return refs;
  }
  return refs.filter((ref) => {
    const target = bestCovergroupDoc(ref.name, testpointDoc.filePath, fileDocs);
    return covergroupMatchesRole(target, filter);
  });
}

function testpointCgRefs(testpointDoc) {
  const values = testpointDoc.fields.get("mapped-covergroups") || [];
  const refs = [];
  for (const value of values) {
    const match = value.match(new RegExp(`^(cg_[A-Za-z_][A-Za-z0-9_$]*)\\s+\\((${TESTPOINT_CG_RELATION_RE})\\):\\s*(.+?)\\s*$`, "i"));
    if (!match) {
      continue;
    }
    refs.push({
      name: match[1],
      relation: normalizeTestpointCgRelation(match[2]),
      meaning: match[3].trim()
    });
  }
  return refs;
}

function bestCovergroupDoc(name, filePath, fileDocs) {
  const local = (fileDocs || []).filter((doc) => doc.kind === "covergroup" && doc.name === name);
  if (local.length > 0) {
    return sortDocs(local)[0];
  }
  const indexed = symbolIndex.get(name) || [];
  const covergroups = indexed.filter((doc) => doc.kind === "covergroup");
  if (covergroups.length === 0) {
    return undefined;
  }
  const sameFile = covergroups.filter((doc) => doc.filePath === filePath);
  return sortDocs(sameFile.length > 0 ? sameFile : covergroups)[0];
}

function docsForFile(filePath) {
  return sortDocs(canonicalDocs.filter((doc) => doc.filePath === filePath));
}

function sortedIndexedFiles() {
  return [...new Set(publicDocs(canonicalDocs).map((doc) => doc.filePath))].sort((a, b) => {
    const active = activeCoverageFilePath();
    if (a === active && b !== active) {
      return -1;
    }
    if (b === active && a !== active) {
      return 1;
    }
    return relativePath(a).localeCompare(relativePath(b));
  });
}

function activeCoverageFilePath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }
  const filePath = editor.document.uri.fsPath;
  if (isCoverageFile(filePath)) {
    return filePath;
  }
  const sidecarTarget = coverageFileForSidecar(filePath);
  if (sidecarTarget) {
    return sidecarTarget;
  }
  return "";
}

function sortDocs(docs) {
  return [...docs].sort((a, b) => a.line - b.line || kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name));
}

function fileCountSummary(docs) {
  const counts = new Map();
  for (const doc of publicDocs(docs)) {
    counts.set(doc.kind, (counts.get(doc.kind) || 0) + 1);
  }
  return KIND_ORDER
    .filter((kind) => counts.has(kind))
    .map((kind) => `${KIND_LABELS[kind] || kind}: ${counts.get(kind)}`)
    .join(" · ");
}

function docTreeDescription(doc) {
  if (doc.kind === "signal") {
    const parts = [];
    const moduleName = firstField(doc, "module");
    const delay = firstField(doc, "delay-cycles");
    if (moduleName) {
      parts.push(moduleName);
    }
    if (delay) {
      parts.push(delay);
    } else if (doc.fields.has("rtl")) {
      parts.push("RTL");
    } else if (doc.fields.has("driven-by") || doc.fields.has("expr")) {
      parts.push("derived");
    }
    return parts.join(" · ") || docLocationLabel(doc);
  }
  if (doc.kind === "bin") {
    return firstField(doc, "value") || shortDescription(doc);
  }
  if (doc.kind === "testpoint") {
    const refs = testpointCgRefs(doc);
    return refs.length > 0 ? `${refs.length} cg refs` : shortDescription(doc);
  }
  if (doc.kind === "cross" || doc.kind === "coverpoint") {
    return shortDescription(doc);
  }
  return docLocationLabel(doc);
}

function shortDescription(doc) {
  return truncateText(firstField(doc, "expr") || firstField(doc, "meaning") || firstField(doc, "plain") || firstField(doc, "value") || "", 48);
}

function treeTooltipForDoc(doc) {
  const lines = [];
  lines.push(`${KIND_LABELS[doc.kind] || doc.kind}: ${doc.name}`);
  const moduleName = firstField(doc, "module");
  if (moduleName) {
    lines.push(`所属模块: ${moduleName}`);
  }
  const meaning = firstField(doc, "plain") || firstField(doc, "meaning");
  if (meaning) {
    lines.push(`含义: ${meaning}`);
  }
  const expr = firstField(doc, "expr");
  if (expr) {
    lines.push(`表达式: ${expr}`);
  }
  const value = firstField(doc, "value");
  if (value && value !== expr) {
    lines.push(`取值: ${value}`);
  }
  const covergroup = firstField(doc, "covergroup");
  if (covergroup) {
    lines.push(`Covergroup: ${covergroup}`);
  }
  const coverpoint = firstField(doc, "coverpoint");
  if (coverpoint) {
    lines.push(`Coverpoint: ${coverpoint}`);
  }
  const mappedCovergroups = doc.fields.get("mapped-covergroups") || [];
  if (mappedCovergroups.length > 0) {
    lines.push("指向 CG:");
    for (const value of mappedCovergroups.slice(0, 12)) {
      lines.push(`- ${value}`);
    }
  }
  const testpoints = doc.fields.get("testpoints") || [];
  if (testpoints.length > 0) {
    lines.push("测试点:");
    for (const value of testpoints.slice(0, 12)) {
      lines.push(`- ${value}`);
    }
  }
  lines.push(docLocationLabel(doc));
  return lines.join("\n");
}

function treeTooltipForCovergroupRef(ref, testpointDoc, targetDoc) {
  const lines = [];
  lines.push(`${ref.name} (${ref.relation})`);
  lines.push(ref.meaning);
  lines.push(`测试点: ${testpointDoc.name}`);
  if (targetDoc) {
    lines.push(docLocationLabel(targetDoc));
  } else {
    lines.push("未在当前索引中找到对应 covergroup 定义。");
  }
  return lines.join("\n");
}

function iconForKind(kind) {
  const icons = {
    testpoint: "checklist",
    signal: "symbol-variable",
    covergroup: "symbol-namespace",
    coverpoint: "symbol-field",
    bin: "symbol-enum-member",
    cross: "symbol-operator",
    meta: "symbol-misc",
    unknown: "symbol-misc"
  };
  return icons[kind] || "symbol-misc";
}

function capitalizeKind(kind) {
  const text = String(kind || "Symbol");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function openDocCommand(doc) {
  return openLocationCommand(docOpenPath(doc), docOpenLine(doc));
}

function docOpenPath(doc) {
  if (doc.sidecarPath && !doc.sourceLine) {
    return doc.sidecarPath;
  }
  return doc.filePath;
}

function docOpenLine(doc) {
  return doc.definitionLine || doc.line || 1;
}

function docLocationLabel(doc) {
  return `${relativePath(docOpenPath(doc))}:${docOpenLine(doc)}`;
}

function openLocationCommand(filePath, oneBasedLine) {
  return {
    command: "memblockCoverageHover.openLocation",
    title: "Open Symbol",
    arguments: [filePath, oneBasedLine]
  };
}

function clampLineIndex(document, oneBasedLine) {
  const wanted = Math.max((oneBasedLine || 1) - 1, 0);
  return Math.min(wanted, Math.max(document.lineCount - 1, 0));
}

function flashLine(editor, zeroBasedLine) {
  if (!lineHighlightDecoration || !editor || zeroBasedLine < 0 || zeroBasedLine >= editor.document.lineCount) {
    return;
  }
  const text = editor.document.lineAt(zeroBasedLine).text;
  const endChar = Math.max(text.length, 1);
  const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, endChar);
  editor.setDecorations(lineHighlightDecoration, [range]);

  if (lineHighlightTimer) {
    clearTimeout(lineHighlightTimer);
  }
  lineHighlightTimer = setTimeout(() => {
    editor.setDecorations(lineHighlightDecoration, []);
    lineHighlightTimer = undefined;
  }, 2200);
}

function truncateText(text, limit) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, Math.max(limit - 3, 0))}...`;
}

function collectPrecedingComments(lines, lineIndex) {
  const comments = [];
  for (let i = lineIndex - 1; i >= 0 && comments.length < 8; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      break;
    }
    if (/^\/\/\s*@/.test(trimmed)) {
      break;
    }
    if (/^\/\//.test(trimmed)) {
      comments.unshift(trimmed.replace(/^\/\/\s*/, ""));
      continue;
    }
    break;
  }
  return comments;
}

function collectStatement(lines, lineIndex) {
  const codeParts = [];
  const textParts = [];
  const limit = Math.min(lines.length, lineIndex + 16);
  let isDecl = false;
  for (let i = lineIndex; i < limit; i++) {
    const raw = lines[i].trim();
    const code = stripLineComment(lines[i]).trim();
    if (code) {
      if (codeParts.length === 0) {
        isDecl = /^(wire|reg|logic)\b/.test(code);
      }
      codeParts.push(code);
      textParts.push(raw);
    }
    if (/\bendgroup\b/.test(code)) {
      break;
    }
    if (isDecl) {
      if (/;/.test(code)) {
        break;
      }
    } else if (isCoverageHeaderStart(codeParts.join(" "))) {
      if (coverageHeaderHasBodyOpen(codeParts.join(" ")) || coverageHeaderHasTopLevelSemicolon(codeParts.join(" "))) {
        break;
      }
    } else if (/[;{]/.test(code)) {
      break;
    }
  }
  return {
    code: codeParts.join(" "),
    text: textParts.join(" ")
  };
}

function isCoverageHeaderStart(text) {
  return /:\s*(coverpoint|cross)\b/.test(String(text || ""));
}

function coverageHeaderHasBodyOpen(text) {
  const src = String(text || "");
  const keyword = src.match(/:\s*(coverpoint|cross)\b/);
  if (!keyword || keyword.index === undefined) {
    return false;
  }

  const start = keyword.index + keyword[0].length;
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  let sawExpressionContent = false;

  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      continue;
    }

    if (ch === "{") {
      if (stack.length === 0 && sawExpressionContent) {
        return true;
      }
      stack.push(ch);
      sawExpressionContent = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      stack.push(ch);
      sawExpressionContent = true;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) {
        return false;
      }
      sawExpressionContent = true;
      continue;
    }

    sawExpressionContent = true;
  }

  return false;
}

function coverageHeaderHasTopLevelSemicolon(text) {
  const src = String(text || "");
  const keyword = src.match(/:\s*(coverpoint|cross)\b/);
  if (!keyword || keyword.index === undefined) {
    return false;
  }

  const start = keyword.index + keyword[0].length;
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };

  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) {
        return false;
      }
    } else if (ch === ";" && stack.length === 0) {
      return true;
    }
  }

  return false;
}

function findNextCodeLine(lines, oneBasedLine) {
  for (let i = oneBasedLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^\/\//.test(trimmed)) {
      continue;
    }
    return { line: i + 1, text: lines[i] };
  }
  return undefined;
}

function stripLineComment(line) {
  const idx = line.indexOf("//");
  if (idx < 0) {
    return line;
  }
  return line.slice(0, idx);
}

function extractAssignmentExpression(text) {
  const match = text.match(/=\s*(.+?)(?:;|$)/);
  return match ? match[1].trim() : "";
}

function splitTopLevelCommas(text) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(depth - 1, 0);
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

function joinCommentFragments(fragments) {
  const text = fragments
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s*([，。；、：])\s*/gu, "$1");
  return text.replace(/[，,]\s*$/u, "").trim();
}

function extractPathAliases(text) {
  const aliases = new Set();
  const pathRegex = /(?:`?[A-Za-z_][A-Za-z0-9_$]*\.)+([A-Za-z_][A-Za-z0-9_$]*)/g;
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    aliases.add(match[1]);
  }

  return [...aliases];
}

function sanitizeSymbolName(name) {
  return String(name || "")
    .trim()
    .replace(/^`/, "")
    .replace(/[,;]+$/, "");
}

function isCoverageFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.endsWith(".sv") && normalized.includes("/coverage/memblock/");
}

function sidecarPathsForCoverageFile(filePath) {
  const root = memblockRootForFile(filePath);
  const rel = coverageRelativePath(filePath);
  if (!root || !rel) {
    return [];
  }
  const sidecarRel = rel.replace(/\.sv$/i, ".md");
  return [path.join(root, "hover_docs", sidecarRel)];
}

function legacyDocPathForCoverageFile(filePath) {
  const root = memblockRootForFile(filePath);
  const rel = coverageRelativePath(filePath);
  if (!root || !rel) {
    return "";
  }
  return path.join(root, "doc", rel.replace(/\.sv$/i, ".md"));
}

function coverageFileForSidecar(sidecarPath) {
  const normalized = sidecarPath.replace(/\\/g, "/");
  if (!normalized.endsWith(".md")) {
    return "";
  }
  for (const marker of ["/coverage/memblock/hover_docs/", "/coverage/memblock/doc/"]) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      const root = normalized.slice(0, index + "/coverage/memblock".length);
      const rel = normalized.slice(index + marker.length).replace(/\.md$/i, ".sv");
      return path.join(root, rel);
    }
  }
  return "";
}

function memblockRootForFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/coverage/memblock/";
  const index = normalized.indexOf(marker);
  if (index < 0) {
    return "";
  }
  return normalized.slice(0, index + "/coverage/memblock".length);
}

function coverageRelativePath(filePath) {
  const root = memblockRootForFile(filePath);
  if (!root) {
    return "";
  }
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function relativePath(filePath) {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (filePath.startsWith(root)) {
      return path.relative(root, filePath).replace(/\\/g, "/");
    }
  }
  return filePath;
}

function firstField(doc, key) {
  const values = doc.fields.get(key);
  return values && values.length > 0 ? values[0] : "";
}

function escapeMd(text) {
  return String(text || "").replace(/[\\`*_{}[\]()#+.!|-]/g, "\\$&");
}

function inlineCode(text) {
  const raw = String(text || "");
  if (raw.includes("`")) {
    return `\`\` ${raw} \`\``;
  }
  return `\`${escapeCode(raw)}\``;
}

function escapeCode(text) {
  return String(text || "").replace(/`/g, "\\`");
}

module.exports = {
  activate,
  deactivate
};

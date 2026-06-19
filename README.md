# MemBlock Coverage Hover

VSCode hover helper for `/coverage/memblock/**/*.sv` functional coverage files.

The extension is read-only for coverage sources. It does not participate in VCS
compile, simulation, UCDB generation, or testcase execution. It only shows
Markdown hover text when the mouse is placed on a known coverage symbol.

## Features

- Hover help for coverage symbols in `coverage/memblock/**/*.sv`.
- Structured annotation support:
  - `@cov-signal`
  - `@cov-cg` / `@cov-covergroup`
  - `@cov-cp` / `@cov-coverpoint`
  - `@cov-bin`
  - `@cov-cross`
  - `@cov-meta`
- Automatic fallback indexing for unannotated:
  - `covergroup`
  - `coverpoint`
  - `cross`
  - `bins`
  - `wire` / `reg` / `logic`
- RTL alias support. For example, a declaration like:

  ```systemverilog
  wire [1:0] mpp = `CsrMod_PATH._mstatus_regOut_MPP;
  ```

  lets hover work on both `mpp` and `_mstatus_regOut_MPP`.

- Signal relation support:
  - `delayed-from`: inferred from assignments such as `foo_n <= foo;`
  - `driven-by`: inferred from combinational assignments
  - `used-by`: inferred from coverpoint/cross/bin expressions and samples
- Coverpoint/bin ownership:
  - bins show their owning coverpoint/covergroup
  - coverpoints show discovered bins
  - covergroups show discovered coverpoints
- Command palette:
  - `MemBlock Coverage Hover: Rescan Symbols`
  - `MemBlock Coverage Hover: Search Symbol`
  - `MemBlock Coverage Hover: Open Glossary`
  - `MemBlock Coverage Hover: Toggle Enable`
- Optional Explorer side view: `MemBlock Coverage Symbols`.
  - Current-file first outline.
  - Section 0 testpoint directory grouped as testpoint -> direct/proxy covergroup refs.
  - Signal list grouped by RTL alias, delayed/sample window, derived window, helper signal.
  - Covergroup tree grouped as covergroup -> coverpoint -> bin, with cross entries beside coverpoints.
- File watcher: rescans after `coverage/memblock/**/*.sv` changes.
- Optional status bar item: shows loaded symbol count and opens search on click.
- Lazy current-file indexing: normal hover parses only the file being viewed.
- Full workspace scan is reserved for explicit rescan/search/glossary workflows.

## Visual Behavior

Normal editing view is unchanged:

- No inline hints.
- No CodeLens.
- No decorations.
- No diagnostics.
- No wave underline.
- No status bar item by default.
- No Explorer symbols view by default unless `showSymbolsView` is enabled.

Only mouse hover shows a temporary tooltip. Moving the mouse away restores the
normal view.

## Explorer Symbols View

Enable the optional side view with:

```json
"memblockCoverageHover.showSymbolsView": true
```

After reloading VSCode, open Explorer and find:

```text
MemBlock Coverage Symbols
```

The tree is designed as a learning directory, not as extra visual noise in the
source editor.

Typical structure:

```text
Current: cov_micro_1_1_load_entry.sv
  Testpoints
    1.1.1 标量 Load 指令入口
      cg_load_identity_entry      direct
      cg_load_op_family           direct
      cg_load_kill_replay_window  proxy
  Signals
    RTL Aliases
    Delayed / Sampled
    Derived Windows
    Helper Signals
  Covergroups
    cg_load_identity_entry
      cp_entry_source
        normal_scalar_accept
        ldin_filtered_only
        s0_without_ldin
      cp_scalar_ldin_attr
        scalar_rvc
      cp_rd_x0_memory_event
        s0_tlb_req
        s0_dcache_req
        s1_tlb_resp
        s2_dcache_resp
        s3_exceptionbuf
      cx_entry_source_priv
    cg_load_forward_merge
      cp_forward_source
        sbuf
  Concepts / Meta
    SBuffer
```

How to read it:

| Node | Meaning |
|---|---|
| `Testpoints` | Section 0 反标目录里解析出的 `1.1.x` 测试点大类。 |
| `1.1.x ...` | One testpoint bucket; expanding it shows the covergroups it maps to. |
| `cg_*` under `Testpoints` | A direct/proxy covergroup reference; clicking it opens the real covergroup definition. |
| `Signals` | All signal symbols parsed from the current file. |
| `RTL Aliases` | Coverage wires that point directly to RTL hierarchical signals. |
| `Delayed / Sampled` | Signals such as `*_n` or `*_nn`; these are sampled one or more cycles later. |
| `Derived Windows` | Coverage-only event windows such as `*_window`. |
| `Helper Signals` | Encoding, bucket, guard, or helper expressions used by coverpoints. |
| `Covergroups` | Functional coverage groups in the current file. |
| `cp_*` | Coverpoints inside one covergroup. Expanding a coverpoint shows its bins. |
| `bins` | Values or scenarios counted by one coverpoint. |
| `cx_*` | Cross coverage entries for combined dimensions. |
| `Concepts / Meta` | Short concept entries such as SBuffer, LoadUnit, privilege, PBMT, etc. |

Clicking any real symbol node opens the source line. Hover still gives the
short explanation at the symbol itself; the side view gives the bigger map.

The view title also has quick buttons:

| Button | Action |
|---|---|
| `refresh` | Rescan coverage symbols. |
| `search` | Search testpoint / signal / covergroup / coverpoint / bin / cross. |
| `book` | Open generated glossary. |

Default keyboard shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+M`, then `R` | Rescan symbols. |
| `Ctrl+Alt+M`, then `S` | Search symbol. |
| `Ctrl+Alt+M`, then `G` | Open glossary. |
| `Ctrl+Alt+M`, then `T` | Toggle extension enable/disable. |

## Installation Options

This is a plain JavaScript extension. It does not need a TypeScript build step.

### Option A: Run As Extension Development Host

1. Open this folder in VSCode:

   ```text
   coverage/memblock/tools/vscode-memblock-coverage-hover
   ```

2. Press `F5` or run `Debug: Start Debugging`.
3. In the new Extension Development Host window, open the workspace that
   contains `coverage/memblock`.

### Option B: Install As Unpacked Extension

Use the helper script:

```bash
cd ${MEMBLOCK_COV_HOME}/tools/vscode-memblock-coverage-hover
./install_unpacked.sh --remote
```

Then reload VSCode and run:

```text
MemBlock Coverage Hover: Rescan Symbols
```

The script only creates/updates a symlink. It does not copy files or edit SV.

Manual Remote VSCode symlink:

```bash
mkdir -p ~/.vscode-server/extensions
ln -sfn ${MEMBLOCK_COV_HOME}/tools/vscode-memblock-coverage-hover \
  ~/.vscode-server/extensions/wuyuanlong-local.memblock-coverage-hover-0.1.0
```

Manual local desktop VSCode symlink:

```bash
mkdir -p ~/.vscode/extensions
ln -sfn ${MEMBLOCK_COV_HOME}/tools/vscode-memblock-coverage-hover \
  ~/.vscode/extensions/wuyuanlong-local.memblock-coverage-hover-0.1.0
```

## Annotation Format

Even without annotations, the extension tries to infer useful hover content from
SV syntax. Annotations are for high-quality human explanations.

Preferred layout for large coverage files:

```text
coverage/memblock/micro/cov_micro_1_1_load_entry.sv
coverage/memblock/hover_docs/micro/cov_micro_1_1_load_entry.md
```

The `.sv` file stays focused on coverage code. The matching `hover_docs` file
holds signal, covergroup, coverpoint, bin, and cross explanations. The extension
maps them by relative path:

```text
micro/foo.sv -> hover_docs/micro/foo.md
priv/bar.sv  -> hover_docs/priv/bar.md
arch/baz.sv  -> hover_docs/arch/baz.md
```

Lookup priority:

1. `hover_docs/<same relative path>.md`
2. `doc/<same relative path>.md` as a legacy fallback
3. automatic SV parsing

Use `hover_docs` for the current truth. The legacy `doc/` fallback is only a
bridge so older arch/priv notes remain visible while dedicated hover docs are
being written. If an Excel section was removed or renamed, add a matching
`hover_docs` file that says `supplemental` / `非当前 Excel 正式章节`; otherwise
the old `doc/` wording may still look like a formal testpoint chapter.

Sidecar annotation blocks use the same fields as inline comments, but without
the leading `//`:

```text
@cov-signal sbuffer_valid
@plain LoadUnit 拿当前 S1 load 去问 SBuffer；1=发起查询，0=不查询。
@rtl `Loadunit0_PATH.io_sbuffer_valid
@not-proof 不代表 SBuffer 命中；命中字节看 sbuffer_forward_mask。
```

Automatic inference is only a fallback. If a signal is important for learning or
debug, add an explicit sidecar `@cov-signal` block with `@meaning`, `@why`, and
`@debug-miss`. This is especially important for derived windows such as
`*_n`, `*_window`, forward/replay/kill/refill signals, and proxy bins.

Typical hover payload:

| Symbol kind | Hover shows |
|---|---|
| signal | declaration, RTL path alias, delayed/driven source, coverpoint/bin usage |
| covergroup | meaning, Excel rows, sample intent, discovered coverpoints |
| coverpoint | expression, `iff` sample, owning covergroup, discovered bins |
| bin | value expression, owning coverpoint/covergroup, Excel rows if annotated |
| cross | expression, owning covergroup, debug hint if annotated |

### Signal

```systemverilog
// @cov-signal s0_int_iq_fire_n
// @meaning 普通标量 Load 从 int IQ 进入 S0 并成功 fire 的打一拍窗口。
// @expr s0_fire & s0_sel_int_iq & ~s0_out_isPrefetch & ~s0_out_isvec
// @stage S0 sampled as _n
// @why 排除 prefetch/vector/replay，保证 op family coverage 干净。
// @used-by cg_load_identity_entry, cg_load_op_family
// @debug-miss 先查 s0_fire，再查 s0_sel_int_iq，再查 isPrefetch/isvec。
reg s0_int_iq_fire_n;
```

### RTL Alias

```systemverilog
// @cov-signal mpp
// @rtl `CsrMod_PATH._mstatus_regOut_MPP
// @meaning mstatus.MPP，表示 M-mode previous privilege。
// @why 当 MPRV=1 且当前处于 M-mode 时，Load 的 effective privilege 由 MPP 决定。
// @used-by eff_priv_kind, cg_load_request_context.cp_eff_priv
// @debug-miss MPRV 场景 miss 时，先确认 mprv=1，再确认 mpp 是否覆盖 M/S/U。
wire [1:0] mpp = `CsrMod_PATH._mstatus_regOut_MPP;
```

Hover works on both `mpp` and `_mstatus_regOut_MPP`.

### Covergroup

```systemverilog
// @cov-cg cg_load_request_context
// @meaning 覆盖 Load 的 effective privilege、translation、PBMT、PMP/MMIO/Uncache 和对齐属性。
// @excel micro 1.1 rows 24-40, 42-58
// @sample s2_scalar_fire_n, tlb_req_valid_n
// @why S2 保存同一笔 Load 的 PBMT/PMP/TLB/异常上下文，打一拍后和 payload 对齐。
// @debug-miss 先确认 s2_scalar_fire_n 是否出现，再查 satp/mprv/mpp/pbmt/pmp。
covergroup cg_load_request_context;
```

### Bin

```systemverilog
// @cov-bin s0_tlb_req
// @meaning rd=x0 S0 同一条 load 发出 TLB request。
// @excel micro 1.1 rows 11-12
// @coverpoint cp_rd_x0_memory_event
// @sample rd_x0_memory_event_vec
// @not-proof 不证明返回数据/cause byte-exact，也不证明架构 x0 无副作用。
// @debug-miss 查 rd_x0_s0_tlb_req_window。
wildcard bins s0_tlb_req = {5'b1????};
```

### Cross

```systemverilog
// @cov-cross cx_priv_pbmt_align
// @meaning 交叉覆盖 effective privilege x PBMT x align。
// @excel micro 1.1 rows 24-40, 53-58
// @why privilege、memory attribute、alignment 同时变化时最容易暴露路由/异常优先级问题。
// @debug-miss 先分开看 cp_eff_priv、cp_pbmt、cp_align 是否单独 hit。
cx_priv_pbmt_align: cross cp_eff_priv, cp_pbmt, cp_align;
```

## Recommended Field Names

| Field | Meaning |
|---|---|
| `@plain` | Beginner-friendly explanation shown first. |
| `@meaning` | Human explanation. |
| `@background` | Small background concept needed to understand the signal/bin. |
| `@when` | When this window or bin should appear. |
| `@example` | Concrete scenario example. |
| `@expr` | Derived expression. |
| `@rtl` | Original RTL hierarchical signal. |
| `@module` | Owning hardware block shown beside the hover type. Usually inferred from the RTL path. |
| `@stage` | Pipeline stage. |
| `@sample-relation` | Clocked sampling relation, for example `foo_n <= foo @posedge clock`. |
| `@delay-cycles` | Number of cycles between the root source and sampled signal. Often inferred from `_n/_nn` assignment chains. |
| `@why` | Why this signal/bin/cross exists. |
| `@excel` | Workbook row or row range. |
| `@sample` | Sampling event or `iff` condition. |
| `@used-by` | Related covergroups/coverpoints. |
| `@waveform` | Signals to inspect together in a waveform. |
| `@debug-miss` | First debug steps when the bin/signal misses. |
| `@not-proof` | What the coverage hit does not prove. |
| `@alias` | Extra names that should show the same hover. |

## Configuration

Workspace settings:

```json
{
  "memblockCoverageHover.enable": true,
  "memblockCoverageHover.includeGlobs": [
    "**/coverage/memblock/**/*.sv"
  ],
  "memblockCoverageHover.excludeGlob": "**/{.git,node_modules,tools/vscode-memblock-coverage-hover}/**",
  "memblockCoverageHover.showAutoFallback": true,
  "memblockCoverageHover.hoverDetailLevel": "compact",
  "memblockCoverageHover.showSourceLocation": false,
  "memblockCoverageHover.maxHoverFields": 18,
  "memblockCoverageHover.scanOnStartup": false,
  "memblockCoverageHover.showStatusBar": false,
  "memblockCoverageHover.showSymbolsView": true
}
```

`showSymbolsView` defaults to `false` in the extension package to keep new
workspaces quiet. For learning MemBlock coverage, set it to `true`.

## Reducing Hover Delay

There are two independent delay sources.

### VSCode UI hover delay

VSCode waits before showing any hover popup. To make hover feel faster, put this
in workspace or user settings:

```json
{
  "editor.hover.delay": 80
}
```

Lower values feel faster but can make hover popups appear too eagerly.

### Extension scan work

By default this extension does not scan the full workspace on startup. It lazily
indexes the current file on first hover, then reuses the in-memory index while
the document version is unchanged.

For fastest learning on one file, keep:

```json
{
  "memblockCoverageHover.scanOnStartup": false,
  "memblockCoverageHover.showAutoFallback": true
}
```

For a very small index, temporarily narrow `includeGlobs` to the file you are
studying:

```json
{
  "memblockCoverageHover.includeGlobs": [
    "**/coverage/memblock/micro/cov_micro_1_1_load_entry.sv"
  ]
}
```

## Debugging The Extension

Open `View -> Output -> MemBlock Coverage Hover` to see scan summaries and
scan errors.

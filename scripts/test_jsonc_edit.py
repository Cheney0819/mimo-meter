#!/usr/bin/env python3
"""jsonc_edit.py 的回归测试。纯标准库，无外部依赖。

用法：python3 scripts/test_jsonc_edit.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "jsonc_edit.py")

passed = 0
failed = []


def run(*args):
    return subprocess.run(
        [sys.executable, TOOL] + list(args),
        capture_output=True, text=True,
    )


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print("  ok   %s" % name)
    else:
        failed.append(name)
        print("  FAIL %s %s" % (name, detail))


def fresh(content):
    d = tempfile.mkdtemp(prefix="jsonc-")
    if content is not None:
        with open(os.path.join(d, "mimocode.jsonc"), "w", encoding="utf-8") as f:
            f.write(content)
    return d


def load(d):
    with open(os.path.join(d, "mimocode.jsonc"), encoding="utf-8-sig") as f:
        return json.loads(f.read())


def case_plain():
    print("[1] 纯 JSON，保留其它顶层键")
    d = fresh(json.dumps({"model": "mimo-v2", "theme": "dark", "plugin": []}))
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    data = load(d)
    check("model 保留", data.get("model") == "mimo-v2")
    check("theme 保留", data.get("theme") == "dark")
    check("plugin 长度 1", len(data["plugin"]) == 1)
    check("spec 正确", "mimo-meter.mjs" in data["plugin"][0][0])
    shutil.rmtree(d)


def case_line_comments():
    print("[2] 行注释 jsonc")
    d = fresh(
        '{\n'
        '  // 我的模型\n'
        '  "model": "mimo-v2",\n'
        '  "plugin": [["file:///other/p.mjs", {"x": 1}]]\n'
        '}\n'
    )
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    data = load(d)
    check("model 保留", data.get("model") == "mimo-v2")
    check("他人插件保留", any("other/p.mjs" in str(e) for e in data["plugin"]))
    check("他人 options 保留", {"x": 1} in [e[1] for e in data["plugin"] if isinstance(e, list) and len(e) > 1])
    shutil.rmtree(d)


def case_block_comments():
    print("[3] 块注释 jsonc（旧版会在这里静默失败）")
    d = fresh(
        '{\n'
        '  /* 块注释\n'
        '     跨多行 */\n'
        '  "model": "mimo-v2",\n'
        '  "plugin": []\n'
        '}\n'
    )
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    check("model 保留", load(d).get("model") == "mimo-v2")
    shutil.rmtree(d)


def case_slashes_in_string():
    print("[4] 字符串里的 // 不被当注释")
    d = fresh(json.dumps({
        "url": "https://example.com/a//b",
        "plugin": [],
    }, ensure_ascii=False))
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    check("url 完整", load(d).get("url") == "https://example.com/a//b")
    shutil.rmtree(d)


def case_trailing_comma():
    print("[5] 尾逗号")
    d = fresh('{\n  "model": "m",\n  "plugin": [],\n}\n')
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    check("model 保留", load(d).get("model") == "m")
    shutil.rmtree(d)


def case_broken_json():
    print("[6] 语法损坏 → 不写文件、退出码 2")
    bad = '{\n  "plugin": [\n}\n'
    d = fresh(bad)
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 2", r.returncode == 2, r.returncode)
    with open(os.path.join(d, "mimocode.jsonc"), encoding="utf-8") as f:
        check("文件未被修改", f.read() == bad)
    check("未生成 .bak", not os.path.exists(os.path.join(d, "mimocode.jsonc.bak")))
    shutil.rmtree(d)


def case_inherit_options():
    print("[7] 重装继承 options（旧版会清零）")
    d = fresh(json.dumps({
        "plugin": [[
            "file:///old/mimo-meter.mjs",
            {"fx": 7.5, "showCny": False, "currency": "$"},
        ]],
    }))
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    opts = load(d)["plugin"][0][1]
    check("fx 继承", opts.get("fx") == 7.5)
    check("showCny 继承", opts.get("showCny") is False)
    check("currency 继承", opts.get("currency") == "$")
    shutil.rmtree(d)


def case_dedupe():
    print("[8] 旧名 mimo-stats + 本名重复 → 只留一条")
    d = fresh(json.dumps({
        "plugin": [
            ["file:///a/mimo-stats.mjs", {}],
            ["file:///b/mimo-meter.mjs", {}],
            ["file:///c/other.mjs", {}],
        ],
    }))
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    plugins = load(d)["plugin"]
    check("只剩 2 条", len(plugins) == 2, len(plugins))
    check("other 保留", any("other.mjs" in str(e) for e in plugins))
    check("无 mimo-stats", not any("mimo-stats" in str(e) for e in plugins))
    shutil.rmtree(d)


def case_backup_once():
    print("[9] .bak 只写一次，不被覆盖")
    d = fresh(json.dumps({"model": "original", "plugin": []}))
    run("install", d, "/x/mimo-meter.mjs")
    first = open(os.path.join(d, "mimocode.jsonc.bak"), encoding="utf-8").read()
    check("首次 .bak 是原文", '"original"' in first)
    # 改一下配置再装一次
    data = load(d)
    data["model"] = "changed"
    with open(os.path.join(d, "mimocode.jsonc"), "w", encoding="utf-8") as f:
        f.write(json.dumps(data))
    run("install", d, "/x/mimo-meter.mjs")
    second = open(os.path.join(d, "mimocode.jsonc.bak"), encoding="utf-8").read()
    check(".bak 未被覆盖", second == first)
    shutil.rmtree(d)


def case_no_file():
    print("[10] 没有 mimocode.jsonc → 新建")
    d = fresh(None)
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    data = load(d)
    check("有 plugin", isinstance(data.get("plugin"), list) and len(data["plugin"]) == 1)
    check("有 $schema", "$schema" in data)
    check("无 .bak（原文为空）", not os.path.exists(os.path.join(d, "mimocode.jsonc.bak")))
    shutil.rmtree(d)


def case_plugin_not_array():
    print("[11] plugin 是字符串（脏数据）→ 修成数组不崩")
    d = fresh(json.dumps({"model": "m", "plugin": "oops"}))
    r = run("install", d, "/x/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    data = load(d)
    check("plugin 变数组", isinstance(data["plugin"], list))
    check("model 保留", data.get("model") == "m")
    shutil.rmtree(d)


def case_uninstall():
    print("[12] uninstall 只删自己，保留他人")
    d = fresh(json.dumps({
        "model": "m",
        "plugin": [
            ["file:///a/mimo-meter.mjs", {"fx": 7.5}],
            ["file:///b/other.mjs", {"y": 2}],
        ],
    }))
    r = run("uninstall", d)
    check("exit 0", r.returncode == 0, r.stderr)
    data = load(d)
    check("model 保留", data.get("model") == "m")
    check("只剩 other", len(data["plugin"]) == 1)
    check("other 完好", "other.mjs" in data["plugin"][0][0] and data["plugin"][0][1] == {"y": 2})
    shutil.rmtree(d)


def case_uninstall_broken():
    print("[13] uninstall 遇损坏文件 → 不动文件")
    bad = '{"plugin": [ oops ]}'
    d = fresh(bad)
    r = run("uninstall", d)
    check("exit 2", r.returncode == 2, r.returncode)
    check("文件未改", open(os.path.join(d, "mimocode.jsonc"), encoding="utf-8").read() == bad)
    shutil.rmtree(d)


def case_uninstall_noop():
    print("[14] uninstall 无本插件 → 不重写文件")
    original = '{\n  // 保留注释\n  "plugin": []\n}\n'
    d = fresh(original)
    r = run("uninstall", d)
    check("exit 0", r.returncode == 0, r.stderr)
    check("文件字节未变", open(os.path.join(d, "mimocode.jsonc"), encoding="utf-8").read() == original)
    shutil.rmtree(d)


def case_idempotent():
    print("[15] 连续安装两次 → 结果一致")
    d = fresh(json.dumps({"model": "m", "plugin": []}))
    run("install", d, "/x/mimo-meter.mjs")
    a = load(d)
    run("install", d, "/x/mimo-meter.mjs")
    b = load(d)
    check("两次结果相同", a == b)
    check("只有一条", len(b["plugin"]) == 1)
    shutil.rmtree(d)


def case_path_encoding():
    print("[16] 含空格路径被正确 URL 编码")
    d = fresh(json.dumps({"plugin": []}))
    r = run("install", d, "/Applications/Xiaomi MiMo/mimo-meter.mjs")
    check("exit 0", r.returncode == 0, r.stderr)
    spec = load(d)["plugin"][0][0]
    check("空格编码为 %20", "%20" in spec and " " not in spec, spec)
    shutil.rmtree(d)


def case_version():
    print("[17] version 子命令")
    d = tempfile.mkdtemp(prefix="ver-")
    p = os.path.join(d, "x.mjs")
    with open(p, "w", encoding="utf-8") as f:
        f.write('const VERSION = "2.0.1";\n')
    r = run("version", p)
    check("读到版本", r.stdout.strip() == "2.0.1", r.stdout)
    shutil.rmtree(d)


def main():
    for fn in [
        case_plain, case_line_comments, case_block_comments, case_slashes_in_string,
        case_trailing_comma, case_broken_json, case_inherit_options, case_dedupe,
        case_backup_once, case_no_file, case_plugin_not_array, case_uninstall,
        case_uninstall_broken, case_uninstall_noop, case_idempotent,
        case_path_encoding, case_version,
    ]:
        fn()
    print()
    if failed:
        print("FAILED %d / %d: %s" % (len(failed), passed + len(failed), ", ".join(failed)))
        return 1
    print("ALL PASS (%d checks)" % passed)
    return 0


if __name__ == "__main__":
    sys.exit(main())

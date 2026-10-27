#!/usr/bin/env python3
"""mimocode.jsonc 的稳健读写工具。

被 install.sh / uninstall.sh 调用。设计目标只有一个：**任何情况下都不毁用户配置**。

要点：
  * 支持 jsonc 注释（// 与 /* */，且不会误伤字符串里的 //）
  * 支持尾逗号
  * 解析失败 → 退出码 2，绝不写文件
  * 只改 plugin 一个键，其它顶层键（model / theme / ...）原样保留
  * 重装时继承已有的 options（fx / showCny / currency），不清零
  * 首次安装才写 .bak，不覆盖用户最初那份备份
  * 原子写（temp + os.replace），写前写后都校验

用法：
  jsonc_edit.py install   <engine-config 目录> <插件绝对路径>
  jsonc_edit.py uninstall <engine-config 目录>
  jsonc_edit.py version   <mimo-meter.mjs 路径>
"""

import json
import os
import sys
import urllib.parse

SCHEMA = "https://mimo.xiaomi.com/mimocode/config.json"
CONFIG_NAME = "mimocode.jsonc"
# 需要被本插件接管的 spec 特征（含旧版本名，保证从任何旧版本升级都干净）
OWN_MARKERS = ("mimo-meter", "mimo-stats")


# ----------------------------------------------------------------- 文本清洗

def strip_comments(text):
    """去掉 // 与 /* */ 注释，但完整保留字符串内容。

    注释替换为空白，换行保留，这样 JSON 报错的行号仍然准确。
    """
    out = []
    i = 0
    n = len(text)
    in_str = False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n:
            nxt = text[i + 1]
            if nxt == "/":
                while i < n and text[i] != "\n":
                    i += 1
                continue
            if nxt == "*":
                i += 2
                while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                    if text[i] == "\n":
                        out.append("\n")
                    i += 1
                i += 2
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def drop_trailing_commas(text):
    """去掉 } 或 ] 前的多余逗号，同样不误伤字符串。"""
    out = []
    i = 0
    n = len(text)
    in_str = False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == ",":
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if j < n and text[j] in "}]":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def parse_jsonc(raw):
    """严格 JSON 优先；失败再按 jsonc 清洗后解析。都不行就抛 ValueError。"""
    if raw is None or not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        pass
    cleaned = drop_trailing_commas(strip_comments(raw))
    return json.loads(cleaned)  # 让调用方处理异常


# ----------------------------------------------------------------- 条目操作

def spec_of(entry):
    if isinstance(entry, str):
        return entry
    if isinstance(entry, list) and entry and isinstance(entry[0], str):
        return entry[0]
    return None


def options_of(entry):
    if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], dict):
        return entry[1]
    return None


def is_own(spec):
    return bool(spec) and any(m in spec for m in OWN_MARKERS)


def is_valid_entry(entry):
    """合法条目只有两种形态："spec" 或 ["spec", {options}]。
    其它形态（数字、对象、空数组……）引擎本来也加载不了，直接丢掉更安全。"""
    if isinstance(entry, str):
        return bool(entry.strip())
    if isinstance(entry, list) and entry and isinstance(entry[0], str):
        return bool(entry[0].strip())
    return False


# ----------------------------------------------------------------- 文件读写

def read_config(path):
    """返回 (data, raw)。文件不存在 → ({}, None)。"""
    if not os.path.exists(path):
        return {}, None
    # utf-8-sig：顺手吃掉 BOM
    with open(path, "r", encoding="utf-8-sig") as f:
        raw = f.read()
    return parse_jsonc(raw), raw


def backup_once(path, raw):
    """只在还没有 .bak 时备份，保住用户最初那份。"""
    if raw is None:
        return None
    bak = path + ".bak"
    if os.path.exists(bak):
        return None
    with open(bak, "w", encoding="utf-8", newline="\n") as f:
        f.write(raw)
    return bak


def write_config(path, data):
    """原子写 + 回读校验。校验不过就抛异常，调用方负责回滚。"""
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

    # 回读校验：能解析、且 plugin 是数组
    with open(path, "r", encoding="utf-8-sig") as f:
        back = json.loads(f.read())
    if not isinstance(back.get("plugin"), list):
        raise ValueError("回读校验失败：plugin 不是数组")


def restore(path, raw):
    """把原文写回去（仅当有原文时）。"""
    if raw is None:
        try:
            os.remove(path)
        except OSError:
            pass
        return
    tmp = path + ".restore"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(raw)
    os.replace(tmp, path)


# ----------------------------------------------------------------- 子命令

def cmd_install(cfgdir, plugin_path):
    path = os.path.join(cfgdir, CONFIG_NAME)
    try:
        data, raw = read_config(path)
    except Exception as err:
        print("解析 %s 失败，未做任何修改：%s" % (path, err), file=sys.stderr)
        print("请先修好这个文件的语法（常见原因：块注释、单引号、重复键）。", file=sys.stderr)
        return 2

    if not isinstance(data, dict):
        print("配置顶层不是对象，未做任何修改。", file=sys.stderr)
        return 2

    plugins = data.get("plugin")
    if not isinstance(plugins, list):
        if plugins is not None:
            print("警告：plugin 不是数组，已按空数组处理。", file=sys.stderr)
        plugins = []

    keep = []
    inherited = None
    removed = 0
    for entry in plugins:
        spec = spec_of(entry)
        if is_own(spec):
            removed += 1
            opts = options_of(entry)
            if opts is not None:
                inherited = opts
            continue
        keep.append(entry)

    options = dict(inherited) if inherited else {}
    spec = "file://" + urllib.parse.quote(plugin_path)
    keep.append([spec, options])
    data["plugin"] = keep
    data.setdefault("$schema", SCHEMA)

    bak = backup_once(path, raw)
    try:
        write_config(path, data)
    except Exception as err:
        print("写入失败，正在回滚：%s" % err, file=sys.stderr)
        restore(path, raw)
        return 3

    if bak:
        print("已备份原配置：" + bak)
    if removed:
        print("已替换 %d 条旧登记" % removed)
    if inherited:
        print("已继承原有 options：" + json.dumps(inherited, ensure_ascii=False))
    print("已登记插件：" + spec)
    return 0


def cmd_uninstall(cfgdir):
    path = os.path.join(cfgdir, CONFIG_NAME)
    if not os.path.exists(path):
        print("没有 %s，跳过登记清理" % CONFIG_NAME)
        return 0
    try:
        data, raw = read_config(path)
    except Exception as err:
        print("解析 %s 失败，未做任何修改：%s" % (path, err), file=sys.stderr)
        return 2

    if not isinstance(data, dict):
        print("配置顶层不是对象，未做任何修改。", file=sys.stderr)
        return 2

    plugins = data.get("plugin")
    if not isinstance(plugins, list):
        print("plugin 不是数组，无需清理")
        return 0

    keep = [e for e in plugins if not is_own(spec_of(e))]
    removed = len(plugins) - len(keep)
    if not removed:
        print("plugin 数组里没有本插件的登记")
        return 0

    data["plugin"] = keep
    bak = backup_once(path, raw)
    try:
        write_config(path, data)
    except Exception as err:
        print("写入失败，正在回滚：%s" % err, file=sys.stderr)
        restore(path, raw)
        return 3
    if bak:
        print("已备份原配置：" + bak)
    print("已从 plugin 数组移除 %d 项" % removed)
    return 0


def cmd_version(mjs_path):
    """从插件源码里读 VERSION，避免 grep|head 的 SIGPIPE 问题。"""
    try:
        with open(mjs_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("const VERSION = "):
                    return line.split('"')[1]
    except OSError:
        pass
    return None


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 64
    cmd = argv[1]
    if cmd == "install" and len(argv) == 4:
        return cmd_install(argv[2], argv[3])
    if cmd == "uninstall" and len(argv) == 3:
        return cmd_uninstall(argv[2])
    if cmd == "version" and len(argv) == 3:
        ver = cmd_version(argv[2])
        if ver is None:
            print("unknown")
            return 1
        print(ver)
        return 0
    print("参数不对\n" + __doc__, file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))

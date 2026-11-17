/**
 * Python run before every `run_script` body. It turns the process's real
 * stdin/stdout into a JSON-lines tool channel and points `print` at stderr,
 * which the host captures as the script's output.
 *
 * argv: [prelude, script path, JSON list of callable tool names]
 */
export const SCRIPT_PRELUDE = String.raw`
import json as _json, os as _os, sys as _sys

_rpc_in, _rpc_out = _sys.stdin, _sys.stdout
_sys.stdout = _sys.stderr
_sys.stdin = open(_os.devnull)
_next_id = [0]
TOOL_NAMES = tuple(_json.loads(_sys.argv[2]))


class ToolError(Exception):
    """A tool call failed. .tool and .arguments name the failed call."""

    def __init__(self, tool, args, message):
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.arguments = args


def _request(tool, args):
    _next_id[0] += 1
    _rpc_out.write(_json.dumps({"id": _next_id[0], "tool": tool, "args": args}) + "\n")
    _rpc_out.flush()

    return _next_id[0]


def _replies(wanted):
    got = {}
    while len(got) < len(wanted):
        line = _rpc_in.readline()
        if not line:
            raise SystemExit("codeberg: the tool channel closed")

        reply = _json.loads(line)
        if reply.get("id") in wanted:
            got[reply["id"]] = reply

    return got


def parallel(calls, return_errors=False):
    """Run [(tool, args), ...] concurrently; results come back in call order.

    A failed call raises ToolError, or with return_errors=True its slot holds
    the ToolError instead."""
    pairs = [(c[0], dict(c[1]) if len(c) > 1 and c[1] else {}) for c in calls]
    ids = [_request(tool, args) for tool, args in pairs]
    got = _replies(set(ids))

    results = []
    for (tool, args), ident in zip(pairs, ids):
        reply = got[ident]
        if reply.get("ok"):
            results.append(reply.get("result"))
            continue

        error = ToolError(tool, args, reply.get("error", "failed"))
        if not return_errors:
            raise error
        results.append(error)

    return results


def call(tool, **args):
    """Run one tool and return its result; raises ToolError on failure."""
    return parallel([(tool, args)])[0]


class _Tools:
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        return lambda **args: call(name, **args)

    def __dir__(self):
        return list(TOOL_NAMES)


tools = _Tools()

with open(_sys.argv[1], encoding="utf-8") as _file:
    _source = _file.read()

_globals = {
    "__name__": "__main__",
    "call": call,
    "parallel": parallel,
    "tools": tools,
    "ToolError": ToolError,
    "TOOL_NAMES": TOOL_NAMES,
}


def _report(error):
    import traceback as _traceback

    frames = [f for f in _traceback.extract_tb(error.__traceback__) if f.filename == "script.py"]
    lines = ["Traceback (most recent call last):\n", *_traceback.format_list(frames)]
    _sys.stderr.write("".join(lines + _traceback.format_exception_only(error)))


try:
    exec(compile(_source, "script.py", "exec"), _globals)
except SystemExit:
    raise
except BaseException as _error:
    _report(_error)
    _sys.exit(1)
`;

#!/usr/bin/env python3
"""预览静态服务 + 本机 LLM/NAI 代理（密钥只读 live-api.local.json，不回显）。"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT = SCRIPT_DIR.parent.parent  # NovelAI-PC-Clean-...（与 npm run preview 一致）
DEFAULT_CONFIG = SCRIPT_DIR / 'live-api.local.json'
DEFAULT_NAI_URL = 'https://image.novelai.net/ai/generate-image'
LIVE_PREFIX = '/nai-dbgen/preview/live/'
SECRET_BASENAME = 'live-api.local.json'


def _config_path() -> Path:
    override = os.environ.get('ND_LIVE_API_CONFIG', '').strip()
    return Path(override) if override else DEFAULT_CONFIG


def _bind_port() -> int:
    raw = os.environ.get('ND_LIVE_PORT', '').strip()
    if raw:
        return int(raw)
    return 8765


def _load_config() -> dict[str, Any] | None:
    path = _config_path()
    if not path.is_file():
        return None
    try:
        with path.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _missing_fields(cfg: dict[str, Any] | None) -> list[str]:
    missing: list[str] = []
    if not isinstance(cfg, dict):
        return ['llm.baseUrl', 'llm.model', 'llm.apiKey', 'nai.apiKey']
    llm = cfg.get('llm')
    nai = cfg.get('nai')
    llm = llm if isinstance(llm, dict) else {}
    nai = nai if isinstance(nai, dict) else {}
    for key, bucket, name in (
        ('baseUrl', llm, 'llm.baseUrl'),
        ('model', llm, 'llm.model'),
        ('apiKey', llm, 'llm.apiKey'),
        ('apiKey', nai, 'nai.apiKey'),
    ):
        val = bucket.get(key)
        if not isinstance(val, str) or not val.strip():
            missing.append(name)
    return missing


def _status_payload() -> dict[str, Any]:
    cfg = _load_config()
    missing = _missing_fields(cfg)
    if missing:
        return {'ok': False, 'missing': missing}
    assert cfg is not None
    llm = cfg['llm']
    return {
        'ok': True,
        'llm': {'model': str(llm['model']).strip()},
        'nai': {'ready': True},
    }


def _read_json_body(handler: SimpleHTTPRequestHandler) -> dict[str, Any] | None:
    length = int(handler.headers.get('Content-Length') or 0)
    raw = handler.rfile.read(length) if length > 0 else b''
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _send_json(
    handler: SimpleHTTPRequestHandler,
    status: int,
    payload: dict[str, Any],
    *,
    head_only: bool = False,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    if not head_only:
        handler.wfile.write(body)


def _send_raw(
    handler: SimpleHTTPRequestHandler,
    status: int,
    body: bytes,
    content_type: str | None,
) -> None:
    handler.send_response(status)
    if content_type:
        handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _path_only(handler: SimpleHTTPRequestHandler) -> str:
    path = handler.path.split('?', 1)[0]
    return path


def _is_secret_static_request(path: str) -> bool:
    name = Path(path).name
    return name == SECRET_BASENAME or path.rstrip('/').endswith('/' + SECRET_BASENAME)


def _openai_chat_url(base_url: str) -> str:
    trimmed = base_url.strip().rstrip('/')
    if trimmed.endswith('/chat/completions'):
        return trimmed
    return f'{trimmed}/chat/completions'


def _map_json_schema(schema: Any) -> dict[str, Any] | None:
    if not isinstance(schema, dict):
        return None
    if schema.get('type') == 'json_schema' and isinstance(schema.get('json_schema'), dict):
        return schema
    value = schema.get('schema') if isinstance(schema.get('schema'), dict) else schema.get('value')
    if isinstance(value, dict):
        strict = schema.get('strict')
        return {
            'type': 'json_schema',
            'json_schema': {
                'name': schema.get('name') if isinstance(schema.get('name'), str) else 'response',
                'strict': strict if isinstance(strict, bool) else True,
                'schema': value,
            },
        }
    return {
        'type': 'json_schema',
        'json_schema': {
            'name': 'response',
            'strict': True,
            'schema': schema,
        },
    }


def _extract_chat_text(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    choices = data.get('choices')
    if isinstance(choices, list) and choices:
        message = choices[0].get('message') if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get('content')
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif isinstance(part, dict) and isinstance(part.get('text'), str):
                        parts.append(part['text'])
                if parts:
                    return ''.join(parts)
        if isinstance(choices[0], dict) and isinstance(choices[0].get('text'), str):
            return choices[0]['text']
        if isinstance(message, dict):
            for key in ('reasoning_content', 'reasoning'):
                if isinstance(message.get(key), str) and message[key].strip():
                    return message[key]
    return None


def _choice_shape(data: Any) -> str:
    if not isinstance(data, dict):
        return type(data).__name__
    choices = data.get('choices')
    kind = type(choices).__name__
    n = len(choices) if isinstance(choices, (list, dict, str)) else -1
    extra = ''
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        choice = choices[0]
        message = choice.get('message') if isinstance(choice.get('message'), dict) else {}
        content = message.get('content') if isinstance(message, dict) else None
        extra = (
            f" finish={choice.get('finish_reason')}"
            f" choice={','.join(list(choice)[:8])}"
            f" message={','.join(list(message)[:8])}"
            f" content={type(content).__name__}"
        )
    return f"choices={kind}:{n}{extra}"


def _upstream_error_detail(data: Any) -> str:
    if not isinstance(data, dict):
        return ''
    err = data.get('error')
    if isinstance(err, dict):
        text = str(err.get('message') or err.get('type') or '')
    elif isinstance(err, str):
        text = err
    else:
        text = ''
    return text[:400]


def _post_chat(url: str, api_key: str, payload: dict[str, Any]) -> tuple[int, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        return 200, data
    except urllib.error.HTTPError as err:
        try:
            detail = err.read().decode('utf-8', errors='replace')
        except OSError:
            detail = str(err)
        return 502, {'error': f'上游 LLM 失败：{detail[:300]}', 'status': err.code, 'detail': detail[:2000]}
    except Exception as err:  # noqa: BLE001 — 代理边界统一成 JSON
        return 502, {'error': f'上游 LLM 不可达：{err}', 'detail': str(err)[:500]}


def _proxy_llm(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    cfg = _load_config()
    missing = _missing_fields(cfg)
    if missing:
        return 503, {'ok': False, 'missing': missing, 'error': 'live API 未配置完整'}
    assert cfg is not None
    llm = cfg['llm']
    messages = body.get('messages')
    if not isinstance(messages, list):
        return 400, {'error': 'messages 必须是数组'}

    payload: dict[str, Any] = {
        'model': str(llm['model']).strip(),
        'messages': messages,
        'stream': False,
    }
    if 'temperature' in body and body['temperature'] is not None:
        payload['temperature'] = body['temperature']
    if 'max_tokens' in body and body['max_tokens'] is not None:
        payload['max_tokens'] = body['max_tokens']
    # DeepSeek 当前不接受 json_schema。不发送 response_format，形状靠预设正文约束。
    url = _openai_chat_url(str(llm['baseUrl']))
    api_key = str(llm['apiKey']).strip()
    sent = _post_chat(url, api_key, payload)
    if sent[0] != 200:
        detail = json.dumps(sent[1], ensure_ascii=False) if isinstance(sent[1], dict) else ''
        # 当前 DeepSeek 账号不开放 json_schema。改成 json_object 时模型会回 {"type":"json_object"}，所以直接去掉格式约束再问。
        if 'response_format' in payload and 'response_format' in detail:
            payload.pop('response_format', None)
            sent = _post_chat(url, api_key, payload)
        if sent[0] != 200:
            return sent  # type: ignore[return-value]
    data = sent[1]
    text = _extract_chat_text(data)
    if isinstance(text, str) and text.strip() in ('{"type":"json_object"}', '{"type": "json_object"}'):
        text = None
    # 部分中转在 json_schema 下回 200 但 choices 为空（completion_tokens=0）。再发一次不带格式约束。
    if text is None and 'response_format' in payload:
        plain = {k: v for k, v in payload.items() if k != 'response_format'}
        sent = _post_chat(url, api_key, plain)
        if sent[0] != 200:
            return sent  # type: ignore[return-value]
        data = sent[1]
        text = _extract_chat_text(data)
    if text is None:
        detail = _upstream_error_detail(data)
        summary = detail or _choice_shape(data)
        return 502, {'error': f'上游 LLM 响应格式异常：{summary}', 'detail': detail}
    return 200, {'text': text}


def _proxy_nai(body: dict[str, Any]) -> tuple[int, bytes, str | None]:
    cfg = _load_config()
    missing = _missing_fields(cfg)
    if missing:
        payload = json.dumps(
            {'ok': False, 'missing': missing, 'error': 'live API 未配置完整'},
            ensure_ascii=False,
        ).encode('utf-8')
        return 503, payload, 'application/json; charset=utf-8'
    assert cfg is not None
    nai = cfg['nai']
    params = body.get('parameters')
    if 'action' not in body:
        body['action'] = 'generate'
    if isinstance(params, dict):
        for key in list(params):
            if params[key] is None:
                del params[key]
        if 'params_version' not in params:
            params['params_version'] = 4
        sys.stderr.write(
            'nai out model={model} sampler={sampler} noise={noise} steps={steps} '
            'wh={w}x{h} scale={scale}\n'.format(
                model=body.get('model'),
                sampler=params.get('sampler'),
                noise=params.get('noise_schedule'),
                steps=params.get('steps'),
                w=params.get('width'),
                h=params.get('height'),
                scale=params.get('scale'),
            )
        )
    if isinstance(params, dict) and 'tag_hint_transparent_background' in params:
        value = params['tag_hint_transparent_background']
        if isinstance(value, (int, float)):
            params['tag_hint_transparent_background'] = bool(value)
    req = urllib.request.Request(
        DEFAULT_NAI_URL,
        data=json.dumps(body).encode('utf-8'),
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {str(nai['apiKey']).strip()}",
            'Accept': 'application/json, application/zip, application/octet-stream',
            # Cloudflare 1010：默认 Python-urllib 签名会被 image.novelai.net 直接 403。
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
            ctype = resp.headers.get('Content-Type')
            return int(resp.status), raw, ctype
    except urllib.error.HTTPError as err:
        try:
            raw = err.read()
        except OSError:
            raw = str(err).encode('utf-8')
        ctype = err.headers.get('Content-Type') if err.headers else None
        if err.code >= 400:
            snippet = raw[:800].decode('utf-8', 'replace').replace('\n', ' ')
            sys.stderr.write(f'nai upstream {err.code}: {snippet[:600]}\n')
        return int(err.code), raw, ctype
    except Exception as err:  # noqa: BLE001
        payload = json.dumps(
            {'error': '上游 NAI 不可达', 'detail': str(err)[:500]},
            ensure_ascii=False,
        ).encode('utf-8')
        return 502, payload, 'application/json; charset=utf-8'


class LivePreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        # 只记方法/路径/状态类信息；绝不打 Authorization 或请求体
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        path = _path_only(self)
        if _is_secret_static_request(path):
            self.send_error(404, 'Not Found')
            return
        if path == '/nai-dbgen/preview/live/status':
            _send_json(self, 200, _status_payload())
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        path = _path_only(self)
        if _is_secret_static_request(path):
            self.send_error(404, 'Not Found')
            return
        if path == '/nai-dbgen/preview/live/status':
            _send_json(self, 200, _status_payload(), head_only=True)
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        path = _path_only(self)
        if _is_secret_static_request(path):
            self.send_error(404, 'Not Found')
            return
        if path == '/nai-dbgen/preview/live/llm':
            body = _read_json_body(self)
            if body is None:
                _send_json(self, 400, {'error': '请求体必须是 JSON 对象'})
                return
            status, payload = _proxy_llm(body)
            _send_json(self, status, payload)
            return
        if path == '/nai-dbgen/preview/live/nai':
            body = _read_json_body(self)
            if body is None:
                _send_json(self, 400, {'error': '请求体必须是 JSON 对象'})
                return
            status, raw, ctype = _proxy_nai(body)
            _send_raw(self, status, raw, ctype)
            return
        self.send_error(404, 'Not Found')


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_ROOT
    if not root.is_dir():
        print(f'static root not found: {root}', file=sys.stderr)
        sys.exit(1)
    port = _bind_port()
    handler = lambda *a, **kw: LivePreviewHandler(*a, directory=str(root), **kw)  # noqa: E731
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    print(f'live preview http://127.0.0.1:{port}/ (root={root})', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()

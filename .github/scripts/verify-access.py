"""Verificação sem publicação: claims do token OIDC (sem o JWT), leituras com a role e, só se pedida, a sonda S3.

  --claims    pede um token OIDC (audience sts.amazonaws.com) e mostra apenas as claims da matriz, comparando-as
              com as condições da trust; o token nunca é impresso nem gravado
  --aws       com a role já assumida: identidade, index.html ativo, listagem de releases/ e distribuição
  --s3-probe  escreve no máximo releases/_probe/<run>/probe.txt e nunca altera o index.html (plano do A.1, §8);
              antes da primeira escrita, revalida o HEAD atual da main no GitHub
"""
import argparse
import base64
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frontend_release import RELEASES_PREFIX, ReleaseError, read_active  # noqa: E402
from release_cli import aws_clients, fail, main_head_guard, summary  # noqa: E402
from release_gate import ENVIRONMENT, ROLE_NAME  # noqa: E402

CLAIMS = ("aud", "sub", "repository", "repository_id", "repository_owner_id", "environment", "ref", "ref_type",
          "workflow", "workflow_ref", "job_workflow_ref", "event_name", "runner_environment")


def expected_trust(env: dict) -> dict:
    owner, repo = env["GITHUB_REPOSITORY"].split("/", 1)
    return {"aud": "sts.amazonaws.com",
            "sub": f"repo:{owner}@{env['GITHUB_REPOSITORY_OWNER_ID']}/{repo}@{env['GITHUB_REPOSITORY_ID']}:environment:{ENVIRONMENT}",
            "repository_id": env["GITHUB_REPOSITORY_ID"], "repository_owner_id": env["GITHUB_REPOSITORY_OWNER_ID"],
            "environment": ENVIRONMENT, "ref": "refs/heads/main"}


def decode_claims(jwt: str) -> dict:
    payload = jwt.split(".")[1]
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return {k: data.get(k) for k in CLAIMS}


def request_claims(env: dict) -> dict:
    url, token = env.get("ACTIONS_ID_TOKEN_REQUEST_URL"), env.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url or not token:
        fail("Token OIDC indisponível: o job precisa de permissions id-token: write.")
    full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode({"audience": "sts.amazonaws.com"})
    request = urllib.request.Request(full, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - URL fornecida pelo runner
        return decode_claims(json.loads(response.read())["value"])


def claims_report(claims: dict, expected: dict) -> list:
    lines = ["| claim | valor | exigida na trust | confere |", "|---|---|---|---|"]
    for key in CLAIMS:
        exp = expected.get(key)
        lines.append(f"| `{key}` | `{claims.get(key)}` | {'sim' if exp else 'não'} | "
                     f"{('sim' if claims.get(key) == exp else '**NÃO**') if exp else '—'} |")
    return lines


def probe(s3, bucket: str, run: str) -> list:
    """Sonda dos headers condicionais. Resultado = lista de (passo, esperado, obtido)."""
    from botocore.exceptions import ClientError

    key = f"{RELEASES_PREFIX}_probe/{run}/probe.txt"

    def attempt(**kwargs):
        try:
            s3.put_object(Bucket=bucket, **kwargs)
            return "200"
        except ClientError as err:
            return err.response.get("Error", {}).get("Code", "?")

    active = read_active(s3, bucket)
    return [
        ("1 release sem If-None-Match", "AccessDenied", attempt(Key=key, Body=b"probe")),
        ("2 release com If-None-Match", "200", attempt(Key=key, Body=b"probe", IfNoneMatch="*")),
        ("3 repetir com If-None-Match", "PreconditionFailed", attempt(Key=key, Body=b"probe", IfNoneMatch="*")),
        # Sem If-Match, mas com If-None-Match: se o Deny não atuar, o S3 recusa com 412 (objeto existe);
        # em nenhum resultado possível o index.html é sobrescrito.
        ("4 index.html sem If-Match", "AccessDenied", attempt(Key="index.html", Body=b"x", IfNoneMatch="*")),
        ("5 index.html com If-Match errado", "PreconditionFailed",
         attempt(Key="index.html", Body=b"x", IfMatch='"00000000000000000000000000000000"')),
        ("index.html intacto", active["etag"], read_active(s3, bucket)["etag"]),
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claims", action="store_true")
    parser.add_argument("--aws", action="store_true")
    parser.add_argument("--s3-probe", action="store_true")
    parser.add_argument("--bucket", default="")
    parser.add_argument("--distribution-id", default="")
    parser.add_argument("--region", default="")
    args = parser.parse_args(argv)
    env = dict(os.environ)
    if args.claims:
        claims = request_claims(env)
        expected = expected_trust(env)
        summary(["### Claims do token OIDC (sem o JWT)"] + claims_report(claims, expected))
        if any(claims.get(k) != v for k, v in expected.items()):
            fail("O token não satisfaz as condições da trust.")
    if args.aws or args.s3_probe:
        s3, cloudfront, sts = aws_clients(args.region)
        role = sts.get_caller_identity()["Arn"].split(":")[-1]
        if f"/{ROLE_NAME}/" not in f"/{role}/":
            fail("A sessão não é da role de deploy do frontend.")
        active = read_active(s3, args.bucket)
        listing = s3.list_objects_v2(Bucket=args.bucket, Prefix=RELEASES_PREFIX, Delimiter="/")
        dist = cloudfront.get_distribution(Id=args.distribution_id)["Distribution"]
        summary(["### Leituras com a role (nenhuma escrita)",
                 f"- release ativa: `{active['release_id'] or 'legacy'}`",
                 f"- releases publicadas: {len(listing.get('CommonPrefixes', []))}",
                 f"- distribuição: {dist['Status']}"])
    if args.s3_probe:
        try:
            main_head_guard()()  # verificação C: HEAD da main antes da primeira escrita da sonda
        except ReleaseError as err:
            fail(str(err))
        results = probe(s3, args.bucket, f"{env.get('GITHUB_RUN_ID', 'local')}-{env.get('GITHUB_RUN_ATTEMPT', '0')}")
        summary(["### Sonda S3", "| passo | esperado | obtido |", "|---|---|---|"] +
                [f"| {s} | `{e}` | `{o}` |" for s, e, o in results])
        if any(e != o for _, e, o in results):
            fail("A sonda S3 divergiu do esperado: os headers condicionais não estão sendo exigidos como planejado.")


if __name__ == "__main__":
    main()

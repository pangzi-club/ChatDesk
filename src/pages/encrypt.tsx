import { Check, Copy, Lock, LockOpen } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { decryptText, encryptText } from "@/lib/crypto";

function EncryptPage() {
  return (
    <div className="app-page-root flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header>
        <p className="font-medium text-sm text-muted-foreground">Encrypt</p>
        <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-normal">文本加密</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
          使用 AES-GCM-256 加密，密钥仅在本地参与计算，不会上传或保存。
          把生成的字符串和密钥分别发给对方，对方即可在此页面还原原文。
        </p>
      </header>

      <EncryptPanel />
      <DecryptPanel />
    </div>
  );
}

function EncryptPanel() {
  const [plainText, setPlainText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [cipherText, setCipherText] = useState("");
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function handleEncrypt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!plainText.trim() || !passphrase) {
      setError("请输入要加密的文本和密钥。");
      return;
    }

    setIsWorking(true);
    setError("");
    try {
      setCipherText(await encryptText(plainText, passphrase));
    } catch {
      setError("加密失败，请重试。");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-muted/60 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <Lock className="size-4" />
        加密
      </h2>
      <form className="mt-4 flex flex-col gap-4" onSubmit={handleEncrypt}>
        <Field label="要加密的文本" htmlFor="encrypt-input">
          <Textarea
            className="min-h-24 w-full max-w-2xl resize-y bg-background"
            id="encrypt-input"
            onChange={(event) => setPlainText(event.target.value)}
            placeholder="输入需要加密的文本…"
            value={plainText}
          />
        </Field>
        <Field label="密钥" htmlFor="encrypt-key">
          <Input
            autoComplete="off"
            className="h-9 w-full max-w-sm bg-background"
            id="encrypt-key"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="双方约定好的密钥"
            type="password"
            value={passphrase}
          />
        </Field>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div>
          <Button disabled={isWorking} type="submit">
            <Lock className="size-4" />
            {isWorking ? "加密中…" : "生成加密字符串"}
          </Button>
        </div>
      </form>

      {cipherText ? <ResultBlock label="加密字符串（发给对方）" value={cipherText} /> : null}
    </section>
  );
}

function DecryptPanel() {
  const [cipherText, setCipherText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [plainText, setPlainText] = useState("");
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function handleDecrypt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!cipherText.trim() || !passphrase) {
      setError("请输入加密字符串和密钥。");
      return;
    }

    setIsWorking(true);
    setError("");
    setPlainText("");
    try {
      setPlainText(await decryptText(cipherText, passphrase));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解密失败，请重试。");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-muted/60 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <LockOpen className="size-4" />
        解密
      </h2>
      <form className="mt-4 flex flex-col gap-4" onSubmit={handleDecrypt}>
        <Field label="加密字符串" htmlFor="decrypt-input">
          <Textarea
            className="min-h-24 w-full max-w-2xl resize-y bg-background font-mono"
            id="decrypt-input"
            onChange={(event) => setCipherText(event.target.value)}
            placeholder="粘贴收到的加密字符串…"
            value={cipherText}
          />
        </Field>
        <Field label="密钥" htmlFor="decrypt-key">
          <Input
            autoComplete="off"
            className="h-9 w-full max-w-sm bg-background"
            id="decrypt-key"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="双方约定好的密钥"
            type="password"
            value={passphrase}
          />
        </Field>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div>
          <Button disabled={isWorking} type="submit">
            <LockOpen className="size-4" />
            {isWorking ? "解密中…" : "还原原文"}
          </Button>
        </div>
      </form>

      {plainText ? <ResultBlock label="还原的原文" value={plainText} /> : null}
    </section>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <label className="block font-medium text-muted-foreground text-sm" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ResultBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 max-w-3xl rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-muted-foreground text-sm">{label}</p>
        <Button onClick={() => void copyResult()} size="sm" type="button" variant="ghost">
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <p className="mt-2 break-all whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-foreground text-sm leading-6">
        {value}
      </p>
    </div>
  );
}

export { EncryptPage };

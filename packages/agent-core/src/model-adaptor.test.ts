import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyModelAdaptor,
  applyStatelessResponsesProviderOptions,
  isDeepSeekModel,
  isOpenAIResponsesStoreEnabled,
  statelessResponsesMiddleware,
  supportsRequiredToolChoice,
  usesStatelessResponsesApi,
} from "./model-adaptor.ts";

const deepseek = {
  provider: "深度求索 / DeepSeek",
  baseUrl: "https://api.deepseek.com",
  name: "deepseek-v4-flash",
  responsive: true,
};

const openai = {
  provider: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  name: "gpt-5",
  responsive: true,
};

const customGateway = {
  provider: "自定义 / Custom",
  baseUrl: "https://openrouter.ai/api/v1",
  name: "gpt-5",
  responsive: true,
};

test("keeps Responses store enabled only for official OpenAI hosts", () => {
  assert.equal(isOpenAIResponsesStoreEnabled(openai), true);
  assert.equal(usesStatelessResponsesApi(openai), false);
  assert.equal(supportsRequiredToolChoice(openai), true);

  assert.equal(isDeepSeekModel(deepseek), true);
  assert.equal(isOpenAIResponsesStoreEnabled(deepseek), false);
  assert.equal(usesStatelessResponsesApi(deepseek), true);
  assert.equal(supportsRequiredToolChoice(deepseek), false);

  assert.equal(usesStatelessResponsesApi(customGateway), true);
  assert.equal(
    usesStatelessResponsesApi({
      provider: "OpenAI",
      baseUrl: "https://proxy.example.com/v1",
      name: "gpt-5",
      responsive: true,
    }),
    true,
  );
  assert.equal(
    usesStatelessResponsesApi({
      provider: "OpenAI",
      baseUrl: "https://example.openai.azure.com",
      name: "gpt-5",
      responsive: true,
    }),
    false,
  );
});

test("forces store=false without dropping other OpenAI provider options", () => {
  assert.deepEqual(
    applyStatelessResponsesProviderOptions({
      openai: { user: "chatdesk", instructions: "keep going" },
    }),
    {
      openai: { user: "chatdesk", instructions: "keep going", store: false },
    },
  );
  assert.deepEqual(applyStatelessResponsesProviderOptions(undefined), {
    openai: { store: false },
  });
});

test("middleware injects store=false into stream and generate params", async () => {
  const middleware = statelessResponsesMiddleware();
  assert.ok(middleware.transformParams);
  const transformed = await middleware.transformParams({
    type: "stream",
    params: {
      prompt: [],
      providerOptions: { openai: { user: "keep" } },
    } as never,
    model: {} as never,
  });
  assert.equal(
    (transformed.providerOptions as { openai?: { store?: boolean; user?: string } } | undefined)
      ?.openai?.store,
    false,
  );
  assert.equal(
    (transformed.providerOptions as { openai?: { store?: boolean; user?: string } } | undefined)
      ?.openai?.user,
    "keep",
  );
});

test("does not wrap OpenAI or Chat Completions models", () => {
  const inner = {
    specificationVersion: "v3",
    provider: "openai.responses",
    modelId: "passthrough",
  } as never;
  assert.equal(applyModelAdaptor(openai, inner), inner);
  assert.equal(applyModelAdaptor({ ...deepseek, responsive: false }, inner), inner);
});

import type { PlanUserInputRequest } from "@chatdesk/shared";
import { describe, expect, it } from "vitest";
import {
  nextPlanQuestionIndex,
  planAnswersComplete,
  planAnswersResponse,
} from "./chat-plan-questionnaire";

const request: PlanUserInputRequest = {
  questions: [
    {
      id: "one",
      header: "第一题",
      question: "请选择",
      recommendedOptionId: "a",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
    {
      id: "two",
      header: "第二题",
      question: "请选择",
      recommendedOptionId: "c",
      options: [
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
    },
  ],
};

describe("plan questionnaire answers", () => {
  it("only builds a response when every question is answered", () => {
    const partial = {
      one: { questionId: "one", optionId: "a", answer: "A", custom: false },
    };
    expect(planAnswersComplete(request, partial)).toBe(false);
    expect(planAnswersResponse(request, partial)).toBeNull();

    const complete = {
      ...partial,
      two: { questionId: "two", answer: "手动答案", custom: true },
    };
    expect(planAnswersComplete(request, complete)).toBe(true);
    expect(planAnswersResponse(request, complete)?.answers).toEqual([partial.one, complete.two]);
  });

  it("advances to the first unanswered question", () => {
    expect(nextPlanQuestionIndex(request, {})).toBe(0);
    expect(
      nextPlanQuestionIndex(request, {
        one: { questionId: "one", optionId: "a", answer: "A", custom: false },
      }),
    ).toBe(1);
    expect(
      nextPlanQuestionIndex(request, {
        one: { questionId: "one", optionId: "a", answer: "A", custom: false },
        two: { questionId: "two", optionId: "c", answer: "C", custom: false },
      }),
    ).toBe(-1);
  });
});

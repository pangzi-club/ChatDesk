import {
  type PlanUserInputAnswer,
  type PlanUserInputRequest,
  type PlanUserInputResponse,
  sortPlanUserInputOptions,
} from "@chatdesk/shared";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Send } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const CUSTOM_VALUE = "__custom__";

type SubmissionState = "idle" | "submitting" | "sent" | "error";

export function planAnswersComplete(
  request: PlanUserInputRequest,
  answers: Record<string, PlanUserInputAnswer>,
) {
  return request.questions.every((question) => Boolean(answers[question.id]?.answer.trim()));
}

export function planAnswersResponse(
  request: PlanUserInputRequest,
  answers: Record<string, PlanUserInputAnswer>,
): PlanUserInputResponse | null {
  if (!planAnswersComplete(request, answers)) return null;
  return { answers: request.questions.map((question) => answers[question.id]) };
}

export function nextPlanQuestionIndex(
  request: PlanUserInputRequest,
  answers: Record<string, PlanUserInputAnswer>,
) {
  return request.questions.findIndex((question) => !answers[question.id]?.answer.trim());
}

export function ChatPlanQuestionnaire({
  request,
  response,
  disabled = false,
  disabledReason,
  onSubmit,
}: {
  request: PlanUserInputRequest;
  response?: PlanUserInputResponse;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (response: PlanUserInputResponse) => Promise<void>;
}) {
  const instanceId = useId();
  const submittingRef = useRef(false);
  const [answers, setAnswers] = useState<Record<string, PlanUserInputAnswer>>(() =>
    Object.fromEntries((response?.answers ?? []).map((answer) => [answer.questionId, answer])),
  );
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (response?.answers ?? [])
        .filter((answer) => answer.custom)
        .map((answer) => [answer.questionId, answer.answer]),
    ),
  );
  const [customQuestions, setCustomQuestions] = useState<Set<string>>(
    () =>
      new Set(
        (response?.answers ?? [])
          .filter((answer) => answer.custom)
          .map((answer) => answer.questionId),
      ),
  );
  const [submissionState, setSubmissionState] = useState<SubmissionState>(
    response ? "sent" : "idle",
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => {
    const unanswered = nextPlanQuestionIndex(request, answers);
    return unanswered < 0 ? Math.max(0, request.questions.length - 1) : unanswered;
  });

  const submitted = Boolean(response) || submissionState === "sent";
  const submitting = submissionState === "submitting";
  const locked = disabled || submitting || submitted;
  const responseAnswers = response
    ? Object.fromEntries(response.answers.map((answer) => [answer.questionId, answer]))
    : answers;
  const complete = planAnswersComplete(request, answers);
  const currentQuestion = request.questions[currentQuestionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const currentComplete = Boolean(currentAnswer?.answer.trim());
  const isLastQuestion = currentQuestionIndex === request.questions.length - 1;
  const customControlId = currentQuestion
    ? `${instanceId}-${currentQuestion.id}-${CUSTOM_VALUE}`
    : undefined;

  function selectAnswer(questionId: string, value: string) {
    if (locked) return;
    if (value === CUSTOM_VALUE) {
      selectCustomAnswer(questionId);
      return;
    }
    const question = request.questions.find((item) => item.id === questionId);
    const option = question?.options.find((item) => item.id === value);
    if (!option) return;
    setCustomQuestions((current) => {
      const next = new Set(current);
      next.delete(questionId);
      return next;
    });
    setAnswers((current) => ({
      ...current,
      [questionId]: {
        questionId,
        optionId: option.id,
        answer: option.label,
        custom: false,
      },
    }));
    setSubmissionState("idle");
  }

  function selectCustomAnswer(questionId: string) {
    if (locked) return;
    setCustomQuestions((current) => new Set(current).add(questionId));
    setAnswers((current) => {
      const answer = customDrafts[questionId]?.trim();
      if (answer) {
        return { ...current, [questionId]: { questionId, answer, custom: true } };
      }
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setSubmissionState("idle");
  }

  function updateCustomAnswer(questionId: string, value: string) {
    if (locked) return;
    setCustomDrafts((current) => ({ ...current, [questionId]: value }));
    setCustomQuestions((current) => new Set(current).add(questionId));
    setAnswers((current) => {
      const answer = value.trim();
      if (answer) {
        return { ...current, [questionId]: { questionId, answer, custom: true } };
      }
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setSubmissionState("idle");
  }

  async function submitAnswers() {
    const result = planAnswersResponse(request, answers);
    if (!result || locked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmissionState("submitting");
    try {
      await onSubmit(result);
      setSubmissionState("sent");
    } catch {
      setSubmissionState("error");
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <section aria-label="计划问题" className="chat-plan-questionnaire">
      <div aria-live="polite" className="chat-plan-questionnaire-progress">
        <span>
          {submitted
            ? `已回答 ${request.questions.length} 项`
            : `问题 ${currentQuestionIndex + 1} / ${request.questions.length}`}
        </span>
        {submitted ? (
          <span className="chat-plan-questionnaire-status">
            <Check className="size-3.5" /> 已发送
          </span>
        ) : submitting ? (
          <span className="chat-plan-questionnaire-status">
            <LoaderCircle className="size-3.5 animate-spin" /> 正在发送
          </span>
        ) : null}
      </div>
      {submitted ? (
        <div className="chat-plan-questionnaire-answers">
          {request.questions.map((question) => (
            <div className="chat-plan-questionnaire-answer" key={question.id}>
              <span>{question.header}</span>
              <strong>{responseAnswers[question.id]?.answer}</strong>
            </div>
          ))}
        </div>
      ) : (
        <>
          {currentQuestion ? (
            <fieldset className="chat-plan-question" disabled={locked} key={currentQuestion.id}>
              <legend>{currentQuestion.header}</legend>
              <p>{currentQuestion.question}</p>
              <RadioGroup
                aria-label={currentQuestion.question}
                className="chat-plan-question-options"
                disabled={locked}
                onValueChange={(value) => selectAnswer(currentQuestion.id, value)}
                value={
                  customQuestions.has(currentQuestion.id) || currentAnswer?.custom
                    ? CUSTOM_VALUE
                    : currentAnswer?.optionId
                }
              >
                {sortPlanUserInputOptions(currentQuestion).map((option) => {
                  const recommended = option.id === currentQuestion.recommendedOptionId;
                  const controlId = `${instanceId}-${currentQuestion.id}-${option.id}`;
                  return (
                    <label
                      className="chat-plan-question-option"
                      htmlFor={controlId}
                      key={option.id}
                    >
                      <RadioGroupItem id={controlId} value={option.id} />
                      <span className="chat-plan-question-option-copy">
                        <span>
                          {option.label}
                          {recommended ? <small>推荐</small> : null}
                        </span>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                    </label>
                  );
                })}
                <label className="chat-plan-question-option is-custom" htmlFor={customControlId}>
                  <RadioGroupItem id={customControlId} value={CUSTOM_VALUE} />
                  <Input
                    aria-label={`${currentQuestion.header}自定义答案`}
                    className="chat-plan-question-custom-input"
                    disabled={locked}
                    onChange={(event) => updateCustomAnswer(currentQuestion.id, event.target.value)}
                    onFocus={() => selectCustomAnswer(currentQuestion.id)}
                    placeholder="自定义答案"
                    value={customDrafts[currentQuestion.id] ?? ""}
                  />
                </label>
              </RadioGroup>
            </fieldset>
          ) : null}
          <div className="chat-plan-questionnaire-footer">
            <span aria-live="polite" className={submissionState === "error" ? "is-error" : ""}>
              {disabled && disabledReason
                ? disabledReason
                : submissionState === "error"
                  ? "发送失败，答案已保留"
                  : isLastQuestion && complete
                    ? "请确认后提交"
                    : currentComplete
                      ? "已保存当前选择"
                      : "请选择一个答案"}
            </span>
            <div className="chat-plan-questionnaire-actions">
              <Button
                aria-label="上一题"
                disabled={locked || currentQuestionIndex === 0}
                onClick={() => setCurrentQuestionIndex((current) => Math.max(0, current - 1))}
                size="icon"
                title="上一题"
                type="button"
                variant="ghost"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              {isLastQuestion ? (
                <Button
                  disabled={locked || !complete}
                  onClick={() => void submitAnswers()}
                  size="sm"
                  type="button"
                >
                  {submissionState === "error" ? null : <Send className="size-3.5" />}
                  {submissionState === "error" ? "重新发送" : "提交答案"}
                </Button>
              ) : (
                <Button
                  disabled={locked || !currentComplete}
                  onClick={() =>
                    setCurrentQuestionIndex((current) =>
                      Math.min(request.questions.length - 1, current + 1),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  下一题 <ChevronRight className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

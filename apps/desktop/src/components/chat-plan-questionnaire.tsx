import {
  type PlanUserInputAnswer,
  type PlanUserInputRequest,
  type PlanUserInputResponse,
  sortPlanUserInputOptions,
} from "@chatdesk/shared";
import { Check, ChevronLeft, CornerDownLeft, LoaderCircle, RotateCcw } from "lucide-react";
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
  const isLastQuestion = currentQuestionIndex === request.questions.length - 1;
  const customControlId = currentQuestion
    ? `${instanceId}-${currentQuestion.id}-${CUSTOM_VALUE}`
    : undefined;

  function completeCurrentQuestion(nextAnswers: Record<string, PlanUserInputAnswer>) {
    setSubmissionState("idle");
    if (isLastQuestion) {
      void submitAnswers(nextAnswers);
      return;
    }
    setCurrentQuestionIndex((current) => Math.min(request.questions.length - 1, current + 1));
  }

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
    const nextAnswers = {
      ...answers,
      [questionId]: {
        questionId,
        optionId: option.id,
        answer: option.label,
        custom: false,
      },
    } satisfies Record<string, PlanUserInputAnswer>;
    setAnswers(nextAnswers);
    completeCurrentQuestion(nextAnswers);
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

  function confirmCustomAnswer(questionId: string) {
    if (locked) return;
    const answer = customDrafts[questionId]?.trim();
    if (!answer) return;
    const nextAnswers = {
      ...answers,
      [questionId]: { questionId, answer, custom: true },
    } satisfies Record<string, PlanUserInputAnswer>;
    setAnswers(nextAnswers);
    completeCurrentQuestion(nextAnswers);
  }

  async function submitAnswers(nextAnswers = answers) {
    const result = planAnswersResponse(request, nextAnswers);
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
                      onClick={(event) => {
                        if (locked || currentAnswer?.optionId !== option.id) return;
                        event.preventDefault();
                        completeCurrentQuestion(answers);
                      }}
                      onKeyDown={(event) => {
                        if (
                          locked ||
                          currentAnswer?.optionId !== option.id ||
                          !["Enter", " "].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        completeCurrentQuestion(answers);
                      }}
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
                <div className="chat-plan-question-option is-custom">
                  <RadioGroupItem
                    aria-label="自定义答案"
                    id={customControlId}
                    value={CUSTOM_VALUE}
                  />
                  <Input
                    aria-label={`${currentQuestion.header}自定义答案`}
                    className="chat-plan-question-custom-input"
                    disabled={locked}
                    onChange={(event) => updateCustomAnswer(currentQuestion.id, event.target.value)}
                    onFocus={() => selectCustomAnswer(currentQuestion.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      confirmCustomAnswer(currentQuestion.id);
                    }}
                    placeholder="自定义答案"
                    value={customDrafts[currentQuestion.id] ?? ""}
                  />
                  <Button
                    aria-label={`确认${currentQuestion.header}自定义答案`}
                    className="chat-plan-question-custom-submit"
                    disabled={locked || !customDrafts[currentQuestion.id]?.trim()}
                    onClick={() => confirmCustomAnswer(currentQuestion.id)}
                    size="icon"
                    title="确认自定义答案"
                    type="button"
                    variant="ghost"
                  >
                    <CornerDownLeft className="size-3.5" />
                  </Button>
                </div>
              </RadioGroup>
            </fieldset>
          ) : null}
          <div className="chat-plan-questionnaire-footer">
            <span aria-live="polite" className={submissionState === "error" ? "is-error" : ""}>
              {disabled && disabledReason
                ? disabledReason
                : submissionState === "error"
                  ? "发送失败，答案已保留"
                  : submitting
                    ? "正在发送答案"
                    : ""}
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
              {submissionState === "error" ? (
                <Button
                  aria-label="重新发送答案"
                  disabled={locked || !complete}
                  onClick={() => void submitAnswers()}
                  size="icon"
                  title="重新发送答案"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

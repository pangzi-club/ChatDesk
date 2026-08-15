import {
  type PlanUserInputAnswer,
  type PlanUserInputRequest,
  type PlanUserInputResponse,
  sortPlanUserInputOptions,
} from "@chatdesk/shared";
import { Check, CornerDownLeft } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const CUSTOM_VALUE = "__custom__";

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
  onSubmit,
}: {
  request: PlanUserInputRequest;
  response?: PlanUserInputResponse;
  disabled?: boolean;
  onSubmit: (response: PlanUserInputResponse) => void;
}) {
  const instanceId = useId();
  const submittedRef = useRef(Boolean(response));
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

  const submitted = Boolean(response) || submittedRef.current;
  const locked = disabled || submitted;
  const responseAnswers = response
    ? Object.fromEntries(response.answers.map((answer) => [answer.questionId, answer]))
    : answers;
  const currentQuestionIndex = nextPlanQuestionIndex(request, answers);
  const currentQuestion =
    currentQuestionIndex >= 0 ? request.questions[currentQuestionIndex] : undefined;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const customSelected = Boolean(
    currentQuestion && (customQuestions.has(currentQuestion.id) || currentAnswer?.custom),
  );
  const selectedValue = customSelected ? CUSTOM_VALUE : currentAnswer?.optionId;

  function updateAnswers(next: Record<string, PlanUserInputAnswer>) {
    setAnswers(next);
    const result = planAnswersResponse(request, next);
    if (!result || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(result);
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
    updateAnswers({
      ...answers,
      [questionId]: {
        questionId,
        optionId: option.id,
        answer: option.label,
        custom: false,
      },
    });
  }

  function selectCustomAnswer(questionId: string) {
    if (locked) return;
    setCustomQuestions((current) => new Set(current).add(questionId));
    setAnswers((current) => {
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }

  function confirmCustomAnswer(questionId: string) {
    if (locked) return;
    const answer = customDrafts[questionId]?.trim();
    if (!answer) return;
    updateAnswers({
      ...answers,
      [questionId]: { questionId, answer, custom: true },
    });
  }

  return (
    <section aria-label="计划问题" className="chat-plan-questionnaire">
      <div aria-live="polite" className="chat-plan-questionnaire-progress">
        <span>
          {submitted
            ? `已回答 ${request.questions.length} / ${request.questions.length}`
            : `问题 ${currentQuestionIndex + 1} / ${request.questions.length}`}
        </span>
        {submitted ? (
          <span className="chat-plan-questionnaire-status">
            <Check className="size-3.5" /> 已发送
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
      ) : currentQuestion ? (
        <fieldset className="chat-plan-question" disabled={locked} key={currentQuestion.id}>
          <legend>{currentQuestion.header}</legend>
          <p>{currentQuestion.question}</p>
          <RadioGroup
            aria-label={currentQuestion.question}
            className="chat-plan-question-options"
            disabled={locked}
            onValueChange={(value) => selectAnswer(currentQuestion.id, value)}
            value={selectedValue}
          >
            {sortPlanUserInputOptions(currentQuestion).map((option) => {
              const recommended = option.id === currentQuestion.recommendedOptionId;
              const controlId = `${instanceId}-${currentQuestion.id}-${option.id}`;
              return (
                <label className="chat-plan-question-option" htmlFor={controlId} key={option.id}>
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
              <RadioGroupItem value={CUSTOM_VALUE} />
              <Input
                aria-label={`${currentQuestion.header}自定义答案`}
                className="chat-plan-question-custom-input"
                disabled={locked}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomDrafts((current) => ({ ...current, [currentQuestion.id]: value }));
                  selectCustomAnswer(currentQuestion.id);
                }}
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
    </section>
  );
}

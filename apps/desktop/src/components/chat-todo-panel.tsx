import { parseTodoList, TODO_TOOL_NAME, type TodoItem } from "@chatdesk/shared";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Check, Circle, ListTodo, LoaderCircle } from "lucide-react";

export type ChatTodoState = {
  items: TodoItem[];
  total: number;
  completed: number;
  current?: TodoItem;
};

/** 从会话消息中提取最近一次合法的 todo_write 状态；无则返回 null。 */
export function getLatestTodoState(messages: UIMessage[]): ChatTodoState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!part || !isToolUIPart(part)) continue;
      if (getToolName(part) !== TODO_TOOL_NAME) continue;
      // 参数流式阶段的 partial JSON 前缀也可能通过校验（列表逐条变长），跳过以免面板抖动。
      if (part.state === "input-streaming") continue;
      if (part.state === "output-error" || part.state === "output-denied") continue;
      const items = parseTodoList(part.input);
      if (!items) continue;
      const completed = items.filter((item) => item.status === "completed").length;
      const current =
        items.find((item) => item.status === "in_progress") ??
        items.find((item) => item.status === "pending");
      return { items, total: items.length, completed, current };
    }
  }
  return null;
}

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return <Check aria-hidden="true" className="chat-todo-detail-icon is-done" />;
  }
  if (status === "in_progress") {
    return (
      <LoaderCircle aria-hidden="true" className="chat-todo-detail-icon is-active animate-spin" />
    );
  }
  return <Circle aria-hidden="true" className="chat-todo-detail-icon" />;
}

export function ChatTodoPanel({ messages }: { messages: UIMessage[] }) {
  const state = getLatestTodoState(messages);
  if (!state) return null;
  const allDone = state.completed === state.total;
  const currentLabel = state.current
    ? state.current.status === "in_progress"
      ? (state.current.activeForm ?? state.current.content)
      : state.current.content
    : "";

  return (
    <div className={`chat-todo-float ${allDone ? "is-done" : ""}`}>
      {allDone ? <Check className="size-3.5" /> : <ListTodo className="size-3.5" />}
      <span className="chat-todo-float-count">
        {state.completed}/{state.total}
      </span>
      <span className="chat-todo-float-label">
        {allDone ? "全部完成" : currentLabel || "任务规划"}
      </span>
      <div className="chat-todo-float-details">
        <p className="chat-todo-float-details-title">
          任务进度 {state.completed}/{state.total}
        </p>
        <ul className="chat-todo-float-details-list">
          {state.items.map((item) => (
            <li className={`chat-todo-detail is-${item.status}`} key={item.content}>
              <TodoStatusIcon status={item.status} />
              <span className="chat-todo-detail-content">
                {item.status === "in_progress" && item.activeForm ? item.activeForm : item.content}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// In-memory TODO store. Data is lost on restart (PoC).

export interface Todo {
  id: number;
  title: string;
  createdAt: Date;
}

const todos = new Map<number, Todo>();
let nextId = 1;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function listTodos({ latency = 0 }: { latency?: number } = {}): Promise<Todo[]> {
  if (latency) await delay(latency); // simulate a slow data source
  return [...todos.values()];
}

export function addTodo(title: string): Todo {
  const todo: Todo = { id: nextId++, title, createdAt: new Date() };
  todos.set(todo.id, todo);
  return todo;
}

export function removeTodo(id: number): boolean {
  return todos.delete(id);
}

export function countTodos(): number {
  return todos.size;
}

// A couple of seed items so the first page isn't empty.
addTodo('Read the Declarative Partial Updates explainer');
addTodo('Stream <template for> patches from Express');

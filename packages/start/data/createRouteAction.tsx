import { useNavigate, useSearchParams, type Navigator } from "@solidjs/router";
import { $TRACK, batch, createSignal, useContext } from "solid-js";
import { FormError, FormImpl, FormProps } from "./Form";

import type { ParentComponent } from "solid-js";
import { isRedirectResponse } from "../server/responses";
import { ServerContext, useRequest } from "../server/ServerContext";
import { ServerFunctionEvent } from "../server/types";
import { refetchRouteData } from "./createRouteData";

interface ActionEvent extends ServerFunctionEvent {}
export interface Submission<T, U> {
  input: T;
  result?: U;
  error?: any;
  clear: () => void;
  retry: () => void;
}

export type RouteAction<T, U> = [
  {
    pending: boolean;
    input?: T;
    result?: U;
    error?: any;
    clear: () => void;
    retry: () => void;
  },
  ((vars: T) => Promise<U>) & {
    Form: T extends FormData ? ParentComponent<FormProps> : never;
    url: string;
  }
];
export type RouteMultiAction<T, U> = [
  Submission<T, U>[] & { pending: Submission<T, U>[] },
  ((vars: T) => Promise<U>) & {
    Form: T extends FormData ? ParentComponent<FormProps> : never;
    url: string;
  }
];

export type Invalidate = ((r: Response) => string | any[] | void) | string | any[];

export function createRouteAction<T = void, U = void>(
  fn: (arg1: void, event: ActionEvent) => Promise<U>,
  options?: { invalidate?: Invalidate }
): RouteAction<T, U>;
export function createRouteAction<T, U = void>(
  fn: (args: T, event: ActionEvent) => Promise<U>,
  options?: { invalidate?: Invalidate }
): RouteAction<T, U>;
export function createRouteAction<T, U = void>(
  fn: (args: T, event: ActionEvent) => Promise<U>,
  options: { invalidate?: Invalidate } = {}
): RouteAction<T, U> {
  let init: { result?: { data?: U; error?: any }; input?: T } = checkFlash<T>(fn);
  const [input, setInput] = createSignal<T | undefined>(init.input);
  const [result, setResult] = createSignal<{ data?: U; error?: any } | undefined>(init.result);
  const navigate = useNavigate();
  const event = useRequest();
  let count = 0;
  function submit(variables: T) {
    const p = fn(variables, event);
    const reqId = ++count;
    batch(() => {
      setResult(undefined);
      setInput(() => variables);
    });
    return p
      .then(async data => {
        if (reqId === count) {
          if (data instanceof Response) {
            await handleResponse(data, navigate, options);
          } else await handleRefetch(data as any[], options);
          if (!data || isRedirectResponse(data)) setInput(undefined);
          else setResult({ data });
        }
        return data;
      })
      .catch(async e => {
        if (reqId === count) {
          if (e instanceof Response) {
            await handleResponse(e, navigate, options);
          }
          if (!isRedirectResponse(e)) {
            setResult({ error: e });
          } else setInput(undefined);
        }
        return undefined;
      }) as Promise<U>;
  }
  submit.url = (fn as any).url;
  submit.Form = ((props: FormProps) => {
    let url = (fn as any).url;
    return (
      <FormImpl
        {...props}
        action={url}
        onSubmission={submission => {
          submit(submission.formData as any);
        }}
      >
        {props.children}
      </FormImpl>
    );
  }) as T extends FormData ? ParentComponent<FormProps> : never;

  return [
    {
      get pending() {
        return !!input() && !result();
      },
      get input() {
        return input();
      },
      get result() {
        return result()?.data;
      },
      get error(): any {
        return result()?.error;
      },
      clear() {
        batch(() => {
          setInput(undefined);
          setResult(undefined);
        });
      },
      retry() {
        const variables = input();
        if (!variables) throw new Error("No submission to retry");
        submit(variables);
      }
    },
    submit
  ];
}

export function createRouteMultiAction<T = void, U = void>(
  fn: (arg1: void, event: ActionEvent) => Promise<U>,
  options?: { invalidate?: Invalidate }
): RouteMultiAction<T, U>;
export function createRouteMultiAction<T, U = void>(
  fn: (args: T, event: ActionEvent) => Promise<U>,
  options?: { invalidate?: Invalidate }
): RouteMultiAction<T, U>;
export function createRouteMultiAction<T, U = void>(
  fn: (args: T, event: ActionEvent) => Promise<U>,
  options: { invalidate?: Invalidate } = {}
): RouteMultiAction<T, U> {
  let init: { result?: { data?: U; error?: any }; input?: T } = checkFlash<T>(fn);
  const [submissions, setSubmissions] = createSignal<Submission<T, U>[]>(
    init.input ? [createSubmission(init.input)[0]] : []
  );
  const navigate = useNavigate();
  const event = useContext(ServerContext);

  function createSubmission(variables: T) {
    let submission: {
      input: T,
      readonly result: U | undefined,
      readonly error: Error | undefined,
      clear(): void,
      retry(): void
    };
    const [result, setResult] = createSignal<{ data?: U; error?: any }>();
    return [
      (submission = {
        input: variables,
        get result() {
          return result()?.data;
        },
        get error() {
          return result()?.error;
        },
        clear() {
          setSubmissions(v => v.filter(i => i.input !== variables));
        },
        retry() {
          setResult(undefined);
          return event && handleSubmit(fn(variables, event));
        }
      }),
      handleSubmit
    ] as const;
    function handleSubmit(p: Promise<Response & { body: U } | U>): Promise<U> {
      p.then(async data => {
        if (data instanceof Response) {
          await handleResponse(data, navigate, options);
          data = data.body;
        } else await handleRefetch(data as any[], options);
        data ? setResult({ data }) : submission.clear();

        return data;
      }).catch(async e => {
        if (e instanceof Response) {
          await handleResponse(e, navigate, options);
        } else await handleRefetch(e, options);
        if (!isRedirectResponse(e)) {
          setResult({ error: e });
        } else submission.clear();
      });
      return p as Promise<U>;
    }
  }
  function submit(variables: T) {
    if (!event) {
      throw new Error('submit was called without an event');
    }
    const [submission, handleSubmit] = createSubmission(variables);
    setSubmissions(s => [...s, submission]);
    return handleSubmit(fn(variables, event));
  }
  submit.url = (fn as any).url;
  submit.Form = ((props: FormProps) => {
    let url = (fn as any).url;
    return (
      <FormImpl
        {...props}
        action={url}
        onSubmission={submission => {
          submit(submission.formData as any);
        }}
      >
        {props.children}
      </FormImpl>
    );
  }) as T extends FormData ? ParentComponent<FormProps> : never;

  return [
    new Proxy<Submission<T, U>[] & { pending: Submission<T, U>[] }>([] as any, {
      get(_, property) {
        if (property === $TRACK) return submissions();
        if (property === "pending") return submissions().filter(sub => !sub.result);
        return submissions()[property as keyof typeof submissions];
      }
    }),
    submit
  ];
}

function handleRefetch(response: Response | string | any[], options: { invalidate?: Invalidate } = {}) {
  return refetchRouteData(
    typeof options.invalidate === "function" ? options.invalidate(response as Response) : options.invalidate
  );
}

function handleResponse(response: Response, navigate: Navigator, options?: { invalidate?: Invalidate }) {
  if (response instanceof Response && isRedirectResponse(response)) {
    const locationUrl = response.headers.get("Location") || "/";
    if (locationUrl.startsWith("http")) {
      window.location.href = locationUrl;
    } else {
      navigate(locationUrl);
    }
  }

  if (isRedirectResponse(response)) return handleRefetch(response, options);
}

function checkFlash<T>(fn: any) {
  const [params] = useSearchParams();

  let param = params.form ? JSON.parse(params.form) : null;
  if (!param || param.url !== (fn as any).url) {
    return {};
  }

  const input = new Map(param.entries);
  return {
    result: {
      error: param.error
        ? new FormError(param.error.message, {
            fieldErrors: param.error.fieldErrors,
            stack: param.error.stack,
            form: param.error.form,
            fields: param.error.fields
          })
        : undefined
    },
    input: input as unknown as T
  };
}

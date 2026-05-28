---
title: QueryClient는 서버 상태를 다루는 매니저였다 — useQuery와 useMutation
date: 2026-05-28
tags: [react, tanstack-query]
---

React 앱 최상단을 열어보면 `<QueryClientProvider client={queryClient}>`가 앱 전체를 감싸고 있는 경우가 많다. 여기서 내려주는 `QueryClient`가 대체 무엇인지 정리해봤다.

## QueryClient = 서버 상태 캐시 + 정책 엔진

`QueryClient`는 TanStack Query(React Query)라는 서버 상태 관리 라이브러리의 중앙 객체였다. 한마디로 **서버에서 받아온 데이터의 캐시 + 그걸 다루는 규칙**을 한 곳에 담은 객체다.

서버 상태는 손으로 다루면 은근히 골치 아프다. 화면마다 fetch하고, 로딩/에러 상태 잡고, 받은 걸 캐시하고, 언제 낡았는지 판단해 다시 받고, 같은 데이터를 동시에 요청하면 합치고, 글 수정 후 목록을 갱신하고… 이걸 `useState + useEffect + fetch`로 매번 반복하면 지옥이다. QueryClient는 이 모든 걸 중앙에서 관리한다.

```
QueryClient
├─ QueryCache      : 받아온 데이터 저장소 (queryKey 기준)
├─ MutationCache   : 진행 중/끝난 쓰기 작업 추적
├─ defaultOptions  : 전역 정책 (retry, staleTime, onError …)
└─ 메서드          : invalidateQueries / setQueryData …
```

백엔드로 치면 **애플리케이션 레벨 캐시 매니저**다. 인메모리 캐시 + TTL(낡음) 정책 + 동일 요청 합치기(request coalescing) + 쓰기 후 캐시 무효화(eviction)를 한 객체가 담당한다.

## client에는 "설정 객체"가 아니라 "인스턴스"가 들어간다

처음에 `<QueryClientProvider client={...}>`의 `client`에 설정 객체를 넣으면 되는 줄 알았는데 아니었다. `client`에는 **`new QueryClient(...)`로 만든 인스턴스**가 들어가야 한다.

```ts
function createQueryClient() {
  return new QueryClient({                       // ← 설정은 '생성자 인자'
    defaultOptions: {
      queries:   { retry: (n, e) => n < 2 && isRetryableError(e) },
      mutations: { retry: false },
    },
    queryCache:    new QueryCache({ onError: logApiError }),
    mutationCache: new MutationCache({ onError: logApiError }),
  })
}
```

설정(`retry`, `onError`)은 생성자에 넣는 **재료**고, 그 결과로 나온 **완성품 인스턴스**가 `client`에 들어간다. 소비자(`useQuery`/`useMutation`)가 이 인스턴스의 메서드를 호출하기 때문에 일반 객체는 안 되고 진짜 클래스 인스턴스여야 했다.

그리고 이 인스턴스는 `useState(createQueryClient)`로 **한 번만** 만든다. 렌더할 때마다 새로 만들면 캐시가 매번 초기화돼 버린다.

## useQuery vs useMutation

TanStack Query의 두 핵심 훅은 방향이 정반대였다.

| | `useQuery` (읽기) | `useMutation` (쓰기) |
|---|---|---|
| 목적 | 데이터 조회 | 데이터 변경 / 액션 |
| HTTP | GET | POST/PUT/PATCH/DELETE |
| 실행 시점 | **자동** (화면 뜨면) | **수동** (`mutate`/`mutateAsync` 호출) |
| 캐시 | 됨 (queryKey로 공유) | 안 됨 (일회성) |
| 부수효과 | 없음(멱등) | 있음(서버 상태 변경) |

핵심 차이는 **자동이냐 수동이냐**, 그리고 그 이유였다. 읽기는 부수효과가 없으니 화면이 뜨면 자동으로 가져와도 안전하다. 반면 쓰기는 서버를 바꾸는 부수효과라 자동으로 돌면 안 된다(로그인이 화면 뜰 때마다 저절로 실행되면 큰일이다). 그래서 `mutate` 함수를 손에 쥐여주고 사용자가 버튼 누를 때 직접 부르게 한다.

느낌상 **CQRS**였다. `useQuery`는 캐시된 읽기(SELECT), `useMutation`은 명시적으로 실행하는 명령(Command). 그리고 보통 mutation 성공 후 `invalidateQueries`로 관련 query를 무효화해 화면을 최신으로 갱신한다.

## 우리 앱에 대입

우리 로그인은 "버튼 눌러 실행하는 액션 + 세션을 쓰는 부수효과"라 `useMutation`이 맞았다.

```ts
export const useLoginWithGoogleMutation = () =>
  useMutation({
    mutationFn: loginWithGoogle,
    onSuccess: (tokens) => persistSession(tokens),
  })
```

`useMutation`은 `client`를 인자로 받지 않는데도 동작한다. 내부에서 context로 위에서 내려준 QueryClient를 꺼내 쓰기 때문이다. 그래서 한 번 설정한 정책(`mutations: retry:false`, `onError: logApiError`)이 이 로그인에 자동으로 적용된다.

정리하면 `QueryClient`는 서버 상태를 다루는 매니저고, `useQuery`/`useMutation`은 그 매니저한테 일을 시키는 창구였다. 둘 다 client를 인자로 받지 않고 context에서 꺼내 쓰기 때문에, 최상단에 하나만 두면 한 번의 설정이 앱 전체에 그대로 적용된다.

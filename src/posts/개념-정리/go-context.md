---
title: "Go의 context — 취소와 타임아웃을 전파하는 끈"
date: 2026-06-11
tags: [go, context, cancellation, timeout]
---

Go 서버 코드를 읽으면 거의 모든 함수의 첫 번째 인자가 `ctx context.Context`다. 처음엔 이게 뭔지, 왜 매번 들고 다녀야 하는지 의아하다. `context`는 Go 표준 라이브러리이고, "요청 하나가 사는 동안 취소·타임아웃·요청값을 모든 함수에 전달하는 끈"이다. 이 글은 그 정체와 동작을 정리한다.

## context가 하는 일

웹 요청 하나가 들어오면 컨트롤러 → 유스케이스 → 도메인 → DB까지 함수 호출이 길게 이어진다. `context`는 이 호출 사슬을 관통하면서 세 가지를 전달한다.

- **취소 신호**: "이 요청 취소됐으니 작업 멈춰"
- **타임아웃/데드라인**: "이 시간 안에 못 끝내면 중단해"
- **요청 범위 값**: traceID, 요청 ID 등

자바·스프링에서는 이걸 `ThreadLocal`이나 프레임워크가 숨겨서 자동으로 전달하지만, Go는 `ctx`를 첫 인자로 직접 들고 다닌다. 번거롭지만 "이 함수가 취소될 수 있다"는 사실이 시그니처에 드러나는 장점이 있다.

## 왜 필요한가

대표적인 시나리오는 외부 의존성에 타임아웃을 거는 것이다.

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
tossClient.RequestPayment(ctx, ...)   // 5초 안 응답하면 취소
```

외부 결제사가 응답하지 않는데 우리 서버가 무한정 묶이는 걸 막는다. 실무에서 가장 자주 쓰는 용도다. 또 다른 예는 사용자가 요청 도중 연결을 끊은 경우다. 연결이 끊기면 `ctx`에 취소가 전파되고, 그 `ctx`를 넘긴 DB 쿼리도 함께 중단되어 자원을 아낀다.

## 생성과 취소 신호 받기

```go
ctx := context.Background()                            // 최상위 빈 컨텍스트
ctx, cancel := context.WithTimeout(ctx, 5*time.Second) // 타임아웃
defer cancel()                                         // 끝나면 정리
ctx = context.WithValue(ctx, "traceID", "abc-123")     // 값 담기
```

`WithTimeout`/`WithCancel`은 `(ctx, cancel)` 두 개를 반환한다. `defer cancel()`로 함수가 끝날 때 컨텍스트 자원을 정리하는 게 정석이다.

취소 신호는 `ctx.Done()`이 반환하는 채널로 받는다.

```go
select {
case <-ctx.Done():       // 취소되면 신호가 옴
    return ctx.Err()     // "취소됨" 또는 "타임아웃" 에러
case result := <-doWork():
    return result        // 정상 완료
}
```

`ctx.Done()`은 "취소 신호가 오는 통로"를 돌려줄 뿐 아무것도 정리하지 않는다. 그래서 `defer ctx.Done()` 같은 코드는 효과가 없다. 정리해야 하는 건 `cancel` 함수이므로 `defer cancel()`이 맞다.

## stateless인데 어떻게 취소를 감지하나

HTTP/gRPC가 stateless인데 취소가 어떻게 전달되는지 헷갈릴 수 있다. 핵심은 **stateless ≠ connectionless**다. stateless는 "요청 *간* 상태를 기억하지 않는다"는 뜻이지, 요청을 *처리하는 동안*의 연결까지 없다는 게 아니다.

- **HTTP**: 클라이언트 연결이 끊기면(TCP FIN/RST) 서버가 감지해 그 요청의 `ctx`를 취소한다.
- **HTTP/2 (gRPC)**: 하나의 TCP 연결에 여러 요청이 스트림으로 섞여 흐른다. 모든 데이터 조각에 스트림 ID가 붙어 있어, 취소할 땐 `RST_STREAM`에 그 번호만 지정해 해당 요청 하나만 취소한다. 연결과 다른 요청은 멀쩡하다.
- **타임아웃**: 네트워크와 무관하게 서버 내부 타이머가 `ctx`를 취소한다.

서버는 요청마다 별도의 `ctx`를 만들고, `ctx`는 그 요청을 처리하는 동안만 살다 끝나면 소멸한다. 요청 간에 저장하지 않으므로 stateless 원칙을 깨지 않는다.

## 취소는 강제 종료가 아니라 협조 요청이다

중요한 오해 하나. context 취소는 "멈춰 달라는 신호"이지 강제 종료가 아니다. 받는 코드가 `ctx`를 확인해야만 멈춘다.

```go
db.QueryContext(ctx, "SELECT ...")   // ctx 넘김 → 취소되면 쿼리 중단
db.Query("SELECT ...")               // ctx 무시 → 취소 신호 와도 끝까지 실행
```

DB 쿼리 취소도 OS 프로세스를 죽이는 게 아니다. 드라이버가 DB에 "그 쿼리 취소해 달라"는 요청을 보내거나(PostgreSQL의 `CancelRequest`) 그 연결을 닫아서, DB가 실행 중이던 쿼리를 중단하고 롤백하게 만든다. DB 서버와 다른 세션은 멀쩡하고 그 쿼리 하나만 멈춘다.

그래서 100초짜리 쿼리를 중간에 취소하면 DB가 그 쿼리를 중단하고 쓰기였으면 롤백한다. 단 "칼같이 즉시"가 아니라 안전한 체크 지점에서 멈추고, **이미 커밋된 트랜잭션은 되돌릴 수 없다.** 취소는 롤백이 아니다.

## 관례

- 함수의 첫 번째 인자로 받는다: `func F(ctx context.Context, ...)`
- struct 필드에 저장하지 않는다. 항상 인자로 전달한다 (요청마다 다르므로).
- 모르면 `nil` 대신 `context.Background()`를 쓴다.
- 받으면 하위 호출로 계속 전달한다. 끊지 않는다.

---
title: "Go의 에러, panic, defer"
date: 2026-06-11
tags: [go, error, panic, recover, defer]
---

자바·코틀린은 실패를 예외로 다룬다. `throw`로 던지고 `try-catch`로 잡는다. Go는 이 모델을 거의 버렸다. 예상 가능한 실패는 에러를 값으로 반환하고, 정말 치명적인 상황에만 `panic`을 쓴다. 그리고 정리 작업은 `defer`로 예약한다. 이 세 가지가 Go의 실패·자원 관리 방식이다.

## 에러는 값이다

Go에는 예외가 없다. 함수는 마지막 반환값으로 `error`를 돌려주고, 호출하는 쪽이 `if err != nil`로 확인한다.

```go
coupon, err := getCoupon(id)
if err != nil {
    return err   // 처리하거나 위로 전파
}
```

성공하면 `(값, nil)`, 실패하면 `(빈 값, 에러)`를 반환하는 게 국룰이다. 이 방식의 장점은 "어떤 함수가 실패할 수 있는지"가 시그니처에 그대로 드러난다는 점이다. 단점은 장황함인데, Go는 그 장황함을 "에러를 숨기지 않는 비용"으로 받아들인다.

`error`는 사실 인터페이스다. `Error() string` 메서드 하나만 가지면 에러가 된다. 그래서 프로젝트마다 자체 에러 타입(`IError` 같은)을 정의해 코드·메시지·원인을 담기도 한다.

## panic은 비상 정지다

`panic`은 "이건 도저히 정상 진행 불가"인 상황에서 프로그램을 비상 정지시킨다. 자바의 `throw new RuntimeException`에 가깝다.

```go
err = yaml.Unmarshal(file, &config)
if err != nil {
    panic(err)   // 설정 파싱 실패 → 앱이 돌 수 없으니 죽임
}
```

panic이 발생하면 현재 함수를 즉시 멈추고, `defer`들을 실행하면서 호출 스택을 거슬러 올라간다. 끝까지 아무도 막지 않으면 프로그램 전체가 죽고 스택 트레이스를 출력한다. 자바에서 잡히지 않은 예외가 스택 트레이스를 찍고 죽는 것과 같다.

error와 panic의 경계는 명확하다.

| | error (값 반환) | panic |
|---|---|---|
| 성격 | 예상된 실패 | 치명적·복구 불가 |
| 빈도 | 대부분 (99%) | 드물게 |
| 예 | DB 조회 실패, 입력 검증, "쿠폰 없음" | 필수 설정 로딩 실패, nil 역참조 |

Go 커뮤니티의 격언은 "Don't panic"이다. 사용자 입력 검증이나 네트워크 에러처럼 예상 가능한 실패는 전부 `error`로 다루고, panic은 "실패하면 어차피 앱이 못 돌아가는" 상황에만 아껴 쓴다. panic이 자주 보이는 코드는 보통 나쁜 신호다.

## recover로 panic을 잡는다

`recover`로 panic을 잡아 프로그램이 죽지 않게 할 수 있다. 단, `defer` 안에서만 작동한다. 자바의 `catch`에 해당한다.

```go
func safeRun() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("패닉 복구:", r)
        }
    }()
    panic("터졌다!")   // 위 defer가 잡아서 프로그램이 죽지 않음
}
```

| Go | 자바 |
|---|---|
| `panic(x)` | `throw new RuntimeException(x)` |
| `recover()` (defer 안) | `catch (Exception e)` |
| `defer` | `finally` |

## defer는 finally다

`defer`는 "이 함수가 끝날 때 이걸 실행해 달라"고 예약하는 키워드다. 자바의 `finally`에 해당한다.

```go
func readFile() error {
    file, err := os.Open("a.txt")
    if err != nil {
        return err
    }
    defer file.Close()   // 열자마자 "끝나면 닫아" 예약

    // ... 중간에 어떤 경로로 return해도 file.Close()는 항상 실행됨
    return nil
}
```

`defer`를 붙인 줄은 그 자리에서 실행되지 않고, 함수가 어떤 경로로든 끝날 때 실행된다. 정상 return이든 에러 return이든 항상 실행되므로, "열었으면 닫기, 잠갔으면 풀기"를 까먹지 않게 해 준다.

```go
mu.Lock()
defer mu.Unlock()   // 함수 끝나면 자동 해제

ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()      // 함수 끝나면 컨텍스트 정리
```

## defer는 함수 앞쪽에 쓴다

흔한 오해가 "defer를 return 직전에 쓴다"는 것이다. 반대다. defer는 **자원을 얻은 직후, 함수 앞쪽에** 써야 한다.

핵심은 defer가 "실행"은 함수 끝에 되지만 "등록"은 그 줄을 지날 때 된다는 점이다. return 직전에 두면, 그 위에서 먼저 return되는 경로에서는 defer가 등록조차 안 돼서 자원이 안 닫힌다.

```go
file, err := os.Open("a.txt")
if err != nil {       // ① 먼저 에러 체크
    return err
}
defer file.Close()    // ② 성공 확인 후 등록 (이 순서가 정석)
```

즉 자원 얻기 → 에러 체크 → defer 등록 순서로 쓴다.

## defer의 세부 동작

알아두면 좋은 두 가지가 있다. defer가 여러 개면 역순(LIFO)으로 실행된다.

```go
defer fmt.Println("1")
defer fmt.Println("2")
defer fmt.Println("3")
// 출력: 3, 2, 1
```

그리고 defer의 인자는 defer를 만나는 시점에 평가(고정)된다.

```go
i := 0
defer fmt.Println(i)   // 이 순간의 i(0)가 캡처됨
i = 99
// 함수 끝나면 0 출력 (99 아님)
```

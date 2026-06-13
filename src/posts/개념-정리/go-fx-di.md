---
title: "Go의 의존성 주입 — uber-fx로 보는 빈 조립"
date: 2026-06-11
tags: [go, fx, dependency-injection, uber-fx, di]
order: 11
---

스프링은 `@Service`, `@Repository`, `@Autowired` 어노테이션만 붙이면 프레임워크가 객체를 만들고 주입한다. Go에는 그런 마법이 없다. 대신 **uber-fx** 같은 DI 라이브러리로 의존성을 명시적으로 조립한다. 이 글은 fx가 어떻게 "빈"을 등록하고 주입하는지, 스프링과 비교하며 정리한다.

## 생성자는 그냥 함수다

먼저 전제. Go에는 생성자 문법이 없어서 `NewXxx`라는 일반 함수로 객체를 만든다.

```go
func NewBanner(config IConfig, repo IRepository) IBanner {
    return &BannerUsecase{config: config, repository: repo}
}
```

`New`는 컴파일러가 특별 취급하는 게 아니라 커뮤니티 관례일 뿐이다. 파라미터로 의존성을 받아 `&Struct{...}`를 반환하는 평범한 함수다.

## fx.Provide = 빈 등록

fx에 이 생성자를 등록하면 그 반환값이 "빈"이 된다.

```go
fx.Provide(
    NewBanner,    // IBanner 빈을 제공
    NewConfig,    // IConfig 빈을 제공
)
```

fx가 보는 건 함수의 시그니처뿐이다. **파라미터는 "필요한 것"(의존성), 반환값은 "제공하는 것"(빈)**으로 해석한다. 그래서 생성자든 일반 함수든 람다든, 반환값이 있는 함수면 다 등록할 수 있다. 이름이 `New`일 필요도 없다. 스프링의 `@Bean` 메서드(이름 자유, 반환 타입이 빈)와 정확히 같은 개념이다.

```go
@Bean
public Service service(Repo repo) { return new Service(repo); }  // 스프링
```

```go
fx.Provide(func(repo Repo) *Service { return &Service{repo} })   // fx
```

## 주입은 시그니처 매칭으로 일어난다

fx는 각 함수의 파라미터 타입을 보고 "이 타입을 제공하는 함수가 누구인가"를 찾아 자동으로 채운다.

```go
func NewA() *A      { return &A{} }
func NewB(a *A) *B  { return &B{a} }   // *A가 필요 → fx가 NewA를 호출해 넣어줌
```

그래서 유스케이스 struct의 필드를 전부 인터페이스(포트) 타입으로 선언해 두면, fx가 그 인터페이스를 구현한 빈을 찾아 주입한다.

```go
type usecase struct {
    repository repository.IRepository   // 포트
    couponService coupon.ICouponService // 포트
}
```

구현체(`gopg`, 도메인 서비스)는 각자 `fx.Provide`로 등록할 때 `fx.As(new(IRepository))` 식으로 "나는 이 인터페이스를 구현한다"고 선언한다. fx가 둘을 연결한다. 스프링이 `@Autowired`로 인터페이스 타입 필드에 구현 빈을 꽂아 주는 것과 같다.

## 같은 타입이 둘이면 이름으로 구분한다

fx의 의존성 키는 **반환 타입**이다. 그래서 같은 타입을 두 함수가 제공하면 충돌한다.

```go
fx.Provide(
    NewOxygenConfig,   // IConfig 반환
    NewNeonConfig,     // IConfig 반환 → 충돌! 둘 중 뭘 주입?
)
```

이때 `fx.Annotate`와 이름 태그로 구분한다.

```go
fx.Provide(
    fx.Annotate(NewOxygenConfig, fx.ResultTags(`name:"oxygen_config"`)),
    fx.Annotate(NewNeonConfig,   fx.ResultTags(`name:"neon_config"`)),
)
```

받는 쪽도 `name:"oxygen_config"`로 콕 집어 받는다. 같은 타입이어도 이름으로 구분된 별개의 빈을 만들 수 있다.

## 빈은 싱글톤이고 lazy다

fx.Provide로 등록한 빈은 기본 싱글톤이다. 타입 하나당 인스턴스 하나를 만들어 앱 전체가 공유한다. 스프링의 기본 빈 스코프와 같다.

차이는 생성 시점이다. fx는 **lazy**다. 등록했다고 바로 만들지 않고, 실제로 그 타입이 필요해질 때 의존성을 거슬러 올라가며 연쇄적으로 생성한다. 아무도 안 쓰는 빈은 만들어지지 않는다.

다만 실전에서는 거의 모든 빈이 시작 시 생성된 것처럼 보인다. 서버를 띄우는 `fx.Invoke`가 핸들러 → 유스케이스 → 도메인 → 리포지토리 → DB로 이어지는 의존성 그래프 대부분을 끌어오기 때문이다.

## 빈으로 둘 것과 두지 말 것

기술적으로는 메서드도 fx에 등록할 수 있고, 그러면 그 메서드의 반환값이 빈이 된다. 하지만 빈은 "앱에서 하나만 있고 계속 재사용되는 것"에만 써야 한다.

| 빈으로 둘 것 | 요청마다 흐르는 것 |
|---|---|
| 서비스, 리포지토리, 설정, DB 풀 | `ctx`, request, response |
| 앱 전체 싱글톤 | 요청 하나 동안만 |
| fx.Provide | 함수 인자로 전달 |

`ctx`나 요청 DTO를 빈으로 만들면 안 된다. 요청마다 달라야 하는 값을 싱글톤으로 박으면 모든 요청이 같은 값을 공유해 버린다. 이런 데이터는 빈이 아니라 함수 인자로 흘려보낸다. fx에는 스프링의 `@RequestScope` 같은 요청 스코프 개념이 없다.

## 조립의 진입점

모든 빈은 최상위에서 한 번 조립된다.

```go
func BuildApp() *fx.App {
    return fx.New(
        infrastructure.Options(),  // DB·HTTP·외부연동 구현체
        domain.Options,            // 도메인 서비스
        usecase.Options,           // 유스케이스
    )
}

func main() {
    app := BuildApp()
    app.Run()   // 그래프 해석 → 객체 생성 → 서버 起動
}
```

`BuildApp()`이 스프링의 `@SpringBootApplication` + `SpringApplication.run()`에 해당한다. 각 패키지의 `fx.go`가 자기 빈을 `Options`로 등록하고, 상위가 하위를 모아 최종적으로 `fx.New`에 넘긴다.

여기서 `infrastructure.Options()`는 함수 호출이고 `domain.Options`는 변수다. 둘 다 결국 `fx.Option`이라 fx.New는 똑같이 받는다. 함수로 만드는 건 인자를 받아야 하거나, 환경에 따라 분기해야 할 때다. `var`는 고정값이라 `if`를 넣을 수 없기 때문이다.

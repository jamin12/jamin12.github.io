---
title: "Go의 함수 타입과 클로저, struct 태그"
date: 2026-06-11
tags: [go, function-type, closure, factory, struct-tag, reflection]
order: 8
---

Go에서 함수는 일급 객체다. 변수에 담고, 인자로 넘기고, 반환할 수 있다. 이걸 이용한 함수 타입·클로저·팩토리 패턴은 실무 코드에서 자주 나온다. 마지막으로 struct 태그도 함께 정리한다. 둘 다 처음 보면 정체를 알기 어려운 문법이다.

## 함수의 시그니처가 곧 타입이다

함수의 "모양(시그니처)"에 이름을 붙여 타입으로 만들 수 있다.

```go
type ConfigFactory func() adapter.IConfig
```

이건 "매개변수가 없고 `adapter.IConfig`를 반환하는 함수"라는 타입에 `ConfigFactory`라는 이름을 붙인 것이다. 코틀린의 `typealias ConfigFactory = () -> IConfig`, 자바의 `Supplier<IConfig>`와 같다.

```go
func() adapter.IConfig            // 인자 0개, IConfig 반환
func(int) error                   // int 받고 error 반환
func(string, int) (bool, error)   // 2개 받고 2개 반환
```

이름을 붙이면 길고 반복되는 시그니처를 줄일 수 있고, "그냥 함수가 아니라 Config를 만드는 팩토리"라는 의미도 드러난다.

## 함수 타입의 값은 실행할 수 있다

함수 타입의 변수는 일반 함수처럼 `()`를 붙여 호출한다.

```go
var f ConfigFactory = func() adapter.IConfig {
    return NewConfig("toss")
}
cfg := f()   // 호출
```

타입 자체(`ConfigFactory`)는 설계도라 실행할 수 없지만, 그 타입의 값(`f`)은 호출할 수 있다. 코틀린 람다를 변수에 담아 `f()`로 부르는 것과 같다.

## 함수를 반환하는 함수 — 팩토리와 클로저

함수가 함수를 반환하면 강력한 패턴이 된다.

```go
func configFactory(configType string) ConfigFactory {
    return func() adapter.IConfig {
        return NewConfig(configType)   // configType을 "기억"한다
    }
}
```

`configFactory("toss")`를 호출하면 Config를 즉시 만들지 않는다. 대신 "나중에 호출하면 toss용 Config를 만들어 주는 함수"를 돌려준다. 생성을 호출 시점으로 미루는 지연 생성(lazy)이다.

```go
factory := configFactory("toss")   // 아직 Config 안 만듦
cfg := factory()                   // 이 순간 생성
```

반환된 함수가 바깥의 `configType`을 품고 있는 것을 클로저(closure)라 한다. 각 팩토리는 자기가 만들어질 때 받은 값을 내부에 들고 다닌다.

```go
tossFactory := configFactory("toss")   // "toss" 기억
usebFactory := configFactory("useb")   // "useb" 기억
tossFactory()   // NewConfig("toss")
usebFactory()   // NewConfig("useb")
```

자바의 람다가 `final` 변수를 캡처하는 것과 같다.

## 왜 객체 대신 팩토리를 넘기나

객체를 직접 넘기는 것과 팩토리(함수)를 넘기는 것은 의도가 다르다.

```go
cfg := NewConfig("toss")          // 지금 즉시 생성
factory := configFactory("toss")  // 만드는 "방법"만 넘김. 나중에 factory()로 생성
```

팩토리를 넘기면 생성을 미루거나(lazy), 호출할 때마다 새 인스턴스를 만들거나, 테스트에서 가짜 팩토리를 주입할 수 있다. 자바의 `Supplier<T>`, `Provider<T>`, 스프링의 `@Lazy`/`ObjectProvider`와 같은 동기다. 의존성 주입(DI) 컨테이너에 "생성 방법"을 등록할 때 특히 자주 쓴다.

## struct 태그 — 값 할당이 아니라 메타데이터

함수 얘기에서 벗어나, 처음 보면 헷갈리는 또 하나의 문법이 struct 태그다.

```go
type Toss struct {
    OAuthUrl string `yaml:"oauth_url"`
    ApiUrl   string `yaml:"api_url"`
}
```

백틱 안의 `yaml:"oauth_url"`은 값 할당이 아니다(`=`가 없다). 필드에 붙이는 메타데이터, 즉 자바·코틀린의 어노테이션에 해당한다.

```kotlin
data class Toss(
    @JsonProperty("oauth_url") val oAuthUrl: String   // Go 태그와 같은 역할
)
```

필요한 이유는 이름 규칙이 달라서다. Go 필드는 public이라 대문자(`OAuthUrl`)지만 YAML 키는 snake_case(`oauth_url`)다. 태그가 둘 사이의 매핑을 알려준다.

## 태그는 라이브러리가 리플렉션으로 읽는다

중요한 점은, 태그 자체는 아무 일도 하지 않는다는 것이다. 실제로 매핑하는 건 라이브러리를 호출하는 코드다.

```go
file, _ := os.ReadFile(path)          // YAML 파일을 텍스트로 읽고
err = yaml.Unmarshal(file, &config)   // 이 호출이 "YAML로 해석"을 결정
```

`yaml.Unmarshal`이 실행될 때 라이브러리가 리플렉션으로 struct의 `yaml:` 태그를 읽어 매핑한다. 값이 채워지는 건 이 시점이다. 그래서 태그가 "YAML임을 아는" 게 아니라, `yaml.Unmarshal`을 호출한 코드가 그렇게 정한 것이다. 같은 필드에 여러 태그를 붙일 수 있는 것도 이 때문이다.

```go
OAuthUrl string `yaml:"oauth_url" json:"oauthUrl" db:"oauth_url"`
```

`json.Unmarshal`을 부르면 `json:` 태그를, `yaml.Unmarshal`을 부르면 `yaml:` 태그를 읽는다. 어떤 라이브러리 함수를 호출하느냐에 따라 다른 태그가 쓰인다.

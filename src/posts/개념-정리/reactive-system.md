---
title: 리액티브 시스템이란
date: 2025-01-21
tags: [reactive, spring-reactive]
order: 1
---

리액티브 시스템은 높은 응답성을 가지고, 탄력적이고 유연하며, 메시지 기반으로 동작하는 시스템이다. 데이터 소스에 변경이 있을 때마다 데이터를 전파하고, 선언형 프로그래밍 패러다임을 따르며, 함수형 프로그래밍 기법을 사용한다.

선언형이란 실행할 동작을 구체적으로 명시하지 않고 목표만 정의하는 방식이다. 코드로 비교하면 차이가 명확하다.

명령형 프로그래밍:

```java
List<Integer> numbers = Arrays.asList(1, 3, 21, 10, 8, 11);
int sum = 0;
for(int number : numbers){
    if(number > 6 && (number % 2 != 0)){
        sum += number;
    }
}
```

선언형 프로그래밍:

```java
List<Integer> numbers = Arrays.asList(1, 3, 21, 10, 8, 11);
int sum = numbers.stream()
    .filter(number -> number > 6 && (number % 2 != 0))
    .mapToInt(number -> number)
    .sum();
```

명령형에서는 어떻게 할지를 하나하나 지시하고, 선언형에서는 무엇을 원하는지만 선언한다.

## 참고

- [The Reactive Manifesto (한국어)](https://www.reactivemanifesto.org/ko)

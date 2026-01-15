---
layout: post
title: "Spring 이벤트 리스너가 동작하는 메커니즘"
date: 2026-01-15
categories: [개념정리, spring boot]
tags: [event, listener, spring]
---

Spring의 이벤트 시스템을 사용하면서 근본적인 의문이 생겼다. `@EventListener`를 붙이기만 하면 이벤트가 발생할 때 자동으로 메서드가 실행되는데, 이게 어떻게 가능한 건지 궁금했다. 백그라운드에서 계속 감시하는 스레드가 있는 것도 아닌데, 어떤 메커니즘으로 "항상 지켜보고 있는 것처럼" 동작하는지 알고 싶었다.

## 시작: "항상 지켜보는" 착각

처음에는 리스너가 백그라운드에서 계속 이벤트를 감시하고 있을 거라고 생각했다. 마치 CCTV처럼 24시간 돌면서 이벤트 발생을 기다리는 구조일 거라고 추측했다.

실제로는 **이벤트 발행 시점에 등록된 리스너 목록을 직접 순회하면서 호출**하는 구조였다. 감시가 아니라 명단 호출에 가까웠다.

## 리스너 등록 메커니즘

### ApplicationListener 인터페이스

Spring은 `ApplicationListener` 인터페이스를 통해 리스너를 정의한다. 제네릭 타입으로 관심있는 이벤트를 지정할 수 있다.

```kotlin
@Component
class MyListener : ApplicationListener<ProjectCreatedEvent> {
    override fun onApplicationEvent(event: ProjectCreatedEvent) {
        // 이벤트 처리
    }
}
```

이 방식은 간단하지만, 하나의 클래스에서 여러 이벤트를 처리하려면 여러 개의 리스너 클래스를 만들어야 했다.

### @EventListener 애노테이션

더 편리한 방법은 `@EventListener` 애노테이션을 사용하는 것이다.

```kotlin
@Component
class ProjectHandler {

    @EventListener
    fun handleCreated(event: ProjectCreatedEvent) {
        // 처리 로직
    }

    @EventListener
    fun handleDeleted(event: ProjectDeletedEvent) {
        // 처리 로직
    }
}
```

하나의 클래스에서 여러 이벤트를 처리할 수 있다. 하지만 여기서 의문이 생겼다. `@EventListener`는 메서드에 붙이는 애노테이션인데, 리스너 목록에는 클래스 인스턴스가 들어가야 한다. 어떻게 메서드를 리스너 목록에 등록하는 걸까?

## Adapter 패턴을 통한 변환

Spring은 `ApplicationListenerMethodAdapter`라는 클래스로 메서드를 감싼다.

```java
public class ApplicationListenerMethodAdapter
    implements GenericApplicationListener {

    private final String beanName;              // "projectHandler"
    private final Method method;                // handleCreated 메서드
    private final ResolvableType declaredEventType;  // ProjectCreatedEvent

    @Override
    public void onApplicationEvent(ApplicationEvent event) {
        // 1. 빈 조회
        Object bean = applicationContext.getBean(beanName);

        // 2. 리플렉션으로 메서드 호출
        method.invoke(bean, event);
    }

    @Override
    public boolean supportsEventType(ResolvableType eventType) {
        return declaredEventType.isAssignableFrom(eventType);
    }
}
```

메서드를 클래스로 "포장"해서 리스너 목록에 저장하는 구조였다. 이렇게 하면 메서드도 `ApplicationListener` 인터페이스를 구현한 객체처럼 다룰 수 있다.

## 등록 과정: EventListenerMethodProcessor

처음에는 `BeanPostProcessor`가 등록을 담당할 거라고 생각했다. 하지만 실제로는 `SmartInitializingSingleton` 인터페이스를 구현한 `EventListenerMethodProcessor`가 처리했다.

```java
public class EventListenerMethodProcessor
    implements SmartInitializingSingleton {

    @Override
    public void afterSingletonsInstantiated() {
        // 모든 싱글톤 빈이 생성된 후 호출됨

        String[] beanNames = beanFactory.getBeanNamesForType(Object.class);

        for (String beanName : beanNames) {
            Class<?> type = beanFactory.getType(beanName);

            // @EventListener가 붙은 메서드 찾기
            Map<Method, EventListener> methods = findAnnotatedMethods(type);

            for (Method method : methods.keySet()) {
                // Adapter 생성
                ApplicationListenerMethodAdapter adapter =
                    new ApplicationListenerMethodAdapter(beanName, type, method);

                // 멀티캐스터에 등록
                applicationEventMulticaster.addApplicationListener(adapter);
            }
        }
    }
}
```

`BeanPostProcessor`는 각 빈이 생성될 때마다 호출되지만, `SmartInitializingSingleton`은 모든 싱글톤 빈이 생성된 후 딱 한 번 호출된다. 이 시점에 모든 빈을 스캔하면서 `@EventListener`를 찾아 등록한다.

Spring의 `refresh()` 프로세스에서 이 과정은 Step 11(finishBeanFactoryInitialization)에서 일어난다. 모든 빈이 준비된 상태이기 때문에 안전하게 스캔하고 등록할 수 있다.

## 이벤트 발행과 리스너 실행

등록이 끝나면, 이벤트 발행 시 어떻게 리스너가 실행되는지 확인했다.

```kotlin
// 이벤트 발행
applicationEventPublisher.publishEvent(ProjectCreatedEvent("p1"))
```

내부적으로는 다음과 같이 동작했다.

```java
// AbstractApplicationContext
protected void publishEvent(Object event, ResolvableType eventType) {
    ApplicationEvent applicationEvent;

    if (event instanceof ApplicationEvent) {
        applicationEvent = (ApplicationEvent) event;
    } else {
        applicationEvent = new PayloadApplicationEvent<>(this, event);
    }

    // 멀티캐스터에 위임
    getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
}

// SimpleApplicationEventMulticaster
public void multicastEvent(ApplicationEvent event, ResolvableType eventType) {
    // 타입에 맞는 리스너 필터링
    Collection<ApplicationListener<?>> listeners =
        getApplicationListeners(event, eventType);

    // 필터링된 리스너들을 순회하며 직접 호출
    for (ApplicationListener<?> listener : listeners) {
        invokeListener(listener, event);
    }
}

private void doInvokeListener(ApplicationListener listener, ApplicationEvent event) {
    listener.onApplicationEvent(event);
}
```

백그라운드 스레드나 polling 메커니즘이 없었다. `publishEvent()`가 호출되는 그 순간, 등록된 리스너 목록을 for 루프로 순회하면서 타입이 맞는 리스너의 메서드를 **직접 호출**하는 방식이었다.

기본적으로 동기 실행이기 때문에, 모든 리스너의 실행이 완료된 후에야 다음 코드가 실행된다.

```kotlin
fun createProject() {
    println("1. 프로젝트 생성")

    publishEvent(ProjectCreatedEvent())  // 여기서 모든 리스너 실행

    println("2. 생성 완료")  // 리스너 실행 후 출력
}
```

## 타입 매칭과 필터링

모든 이벤트가 모든 리스너에게 전달되는 것은 아니다. `ApplicationListener`의 제네릭 타입을 기준으로 필터링한다.

```java
protected boolean supportsEvent(
    ApplicationListener<?> listener,
    ResolvableType eventType,
    Class<?> sourceType) {

    // 리스너가 선언한 이벤트 타입 추출
    ResolvableType declaredEventType = resolveDeclaredEventType(listener);

    // 타입 매칭 확인
    return declaredEventType == null ||
           declaredEventType.isAssignableFrom(eventType);
}
```

상속 관계도 고려한다. `ApplicationListener<ApplicationEvent>`로 선언한 리스너는 모든 하위 이벤트를 받을 수 있다.

```kotlin
// 이벤트 계층
open class ApplicationEvent
    ↑
    └─ ProjectEvent
           ↑
           ├─ ProjectCreatedEvent
           └─ ProjectDeletedEvent

// ProjectCreatedEvent 발행 시:
ApplicationListener<ApplicationEvent>    // ✓ 매칭 (부모)
ApplicationListener<ProjectEvent>        // ✓ 매칭 (부모)
ApplicationListener<ProjectCreatedEvent> // ✓ 매칭 (일치)
ApplicationListener<ProjectDeletedEvent> // ✗ 불일치 (형제)
```

## 일반 클래스의 이벤트 변환

Spring 4.2 이후부터는 `ApplicationEvent`를 상속하지 않은 일반 클래스도 이벤트로 사용할 수 있다.

```kotlin
// ApplicationEvent 상속 없음
data class ProjectCreatedEvent(
    val projectId: String,
    val projectName: String
)

// 발행
publishEvent(ProjectCreatedEvent("p1", "MyProject"))
```

내부적으로는 `PayloadApplicationEvent`로 래핑한다.

```java
protected void publishEvent(Object event, ResolvableType eventType) {
    ApplicationEvent applicationEvent;

    if (event instanceof ApplicationEvent) {
        applicationEvent = (ApplicationEvent) event;
    } else {
        // 일반 객체를 PayloadApplicationEvent로 래핑
        applicationEvent = new PayloadApplicationEvent<>(this, event);
    }

    getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
}
```

`PayloadApplicationEvent`는 원본 객체를 payload 필드에 저장한다.

```java
public class PayloadApplicationEvent<T> extends ApplicationEvent {
    private final T payload;

    public T getPayload() {
        return this.payload;
    }
}
```

리스너에게 전달할 때는 다시 payload를 추출해서 전달한다. 개발자는 여전히 원본 타입을 받을 수 있다.

```kotlin
@EventListener
fun handle(event: ProjectCreatedEvent) {  // 원본 타입
    // Spring이 자동으로 payload 추출
}
```

## 정리

Spring 이벤트 리스너가 "항상 지켜보는 것처럼" 동작한다고 느꼈지만, 실제로는 다음과 같은 메커니즘이었다.

1. `EventListenerMethodProcessor`가 모든 빈을 스캔해서 `@EventListener`를 찾는다
2. 발견한 메서드를 `ApplicationListenerMethodAdapter`로 감싸서 멀티캐스터에 등록한다
3. `publishEvent()`가 호출되면 등록된 리스너 목록을 순회한다
4. 이벤트 타입과 매칭되는 리스너만 필터링한다
5. 필터링된 리스너의 `onApplicationEvent()`를 직접 호출한다
6. Adapter는 리플렉션으로 실제 메서드를 실행한다


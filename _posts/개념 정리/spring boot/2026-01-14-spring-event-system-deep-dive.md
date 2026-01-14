---
layout: post
title: "AbstractApplicationContext와 이벤트 리스너 동작 원리"
date: 2026-01-14
categories: [개념정리, spring boot]
tags: [event, listener]
---

Spring 이벤트 시스템을 사용하다가 내부 동작이 궁금해져서 `AbstractApplicationContext` 소스 코드를 분석했다. 특히 `registerListeners()` 메서드에서 리스너 등록과 Early Events 처리가 어떻게 이루어지는지, 그리고 이벤트가 어떻게 타입별로 필터링되어 전달되는지 확인하고 싶었다.

## 1. AbstractApplicationContext란?

### ApplicationContext = Spring 컨텍스트

`ApplicationContext`는 Spring 컨텍스트를 "만드는" 도구가 아니라 그 자체가 Spring 컨텍스트였다.

```kotlin
// ApplicationContext는 Spring의 중앙 인터페이스
interface ApplicationContext :
    ListableBeanFactory,      // 빈 목록 조회
    HierarchicalBeanFactory,  // 부모-자식 계층
    MessageSource,            // 메시지 국제화
    ApplicationEventPublisher,// 이벤트 발행
    ResourcePatternResolver   // 리소스 로딩
```

### 계층 구조

``` text
┌─────────────────────────────────┐
│   ApplicationContext            │  ← 인터페이스 (계약)
└─────────────────────────────────┘
            ▲
            │ implements
            │
┌─────────────────────────────────┐
│ AbstractApplicationContext      │  ← 추상 클래스 (템플릿)
│ (공통 구현 + refresh() 로직)      │
└─────────────────────────────────┘
            ▲
            │ extends
    ┌───────┴────────┐
    │                │
┌──────────────┐  ┌─────────────────┐
│AnnotationCon │  │ GenericWebAppli │
│figApplication│  │ cationContext   │
│Context       │  │ (웹 전용)        │
└──────────────┘  └─────────────────┘
```

### refresh() 메서드: Spring 컨텍스트 초기화의 핵심

`AbstractApplicationContext`의 핵심 메서드는 `refresh()`였다. 템플릿 메서드 패턴으로 구현되어 있었고, Spring 컨텍스트 초기화 프로세스를 12단계로 정의하고 있었다.

```java
// AbstractApplicationContext.java의 refresh() 메서드 (요약)
public void refresh() throws BeansException, IllegalStateException {
    synchronized (this.startupShutdownMonitor) {
        // 1. prepareRefresh() - 초기화 준비
        // 2. obtainFreshBeanFactory() - BeanFactory 생성
        // 3. prepareBeanFactory() - BeanFactory 설정
        // 4. postProcessBeanFactory() - BeanFactory 후처리
        // 5. invokeBeanFactoryPostProcessors() - BeanFactoryPostProcessor 실행
        // 6. registerBeanPostProcessors() - BeanPostProcessor 등록
        // 7. initMessageSource() - 메시지 소스 초기화
        // 8. initApplicationEventMulticaster() - 이벤트 멀티캐스터 초기화
        // 9. onRefresh() - 서브클래스 훅
        // 10. registerListeners() - 리스너 등록
        // 11. finishBeanFactoryInitialization() - 싱글톤 빈 인스턴스화
        // 12. finishRefresh() - 완료 처리 (ContextRefreshedEvent 발행)
    }
}
```

## 2. registerListeners() 메서드 분석

`registerListeners()` 메서드는 10단계에서 실행되며, 이벤트 리스너들을 등록하고 Early Events를 발행하는 역할을 한다.

### 3단계 구조

```java
// AbstractApplicationContext.java
protected void registerListeners() {
    // 1단계: 정적으로 지정된 리스너 등록
    for (ApplicationListener<?> listener : getApplicationListeners()) {
        getApplicationEventMulticaster().addApplicationListener(listener);
    }

    // 2단계: ApplicationListener 타입의 빈 이름들을 찾아서 등록
    String[] listenerBeanNames = getBeanNamesForType(ApplicationListener.class, true, false);
    for (String listenerBeanName : listenerBeanNames) {
        getApplicationEventMulticaster().addApplicationListenerBean(listenerBeanName);
    }

    // 3단계: 초기 이벤트(early events) 발행
    Set<ApplicationEvent> earlyEventsToProcess = this.earlyApplicationEvents;
    this.earlyApplicationEvents = null;
    if (earlyEventsToProcess != null) {
        for (ApplicationEvent earlyEvent : earlyEventsToProcess) {
            getApplicationEventMulticaster().multicastEvent(earlyEvent);
        }
    }
}
```

### 각 단계의 역할

| 단계 | 메서드 | 역할 |
|------|--------|------|
| 1단계 | `addApplicationListener(listener)` | 정적 리스너 인스턴스 등록 |
| 2단계 | `addApplicationListenerBean(beanName)` | 빈 리스너 이름 등록 (Lazy) |
| 3단계 | `multicastEvent(earlyEvent)` | Early Events 발행 |

## 3. 두 가지 리스너 등록 방식

Spring은 두 가지 방식으로 리스너를 등록한다. 각각의 특징과 사용 시나리오가 달랐다.

### 1번 방식: addApplicationListener(listener) - 인스턴스 직접 등록

```java
public void addApplicationListener(ApplicationListener<?> listener) {
    synchronized (this.defaultRetriever) {
        // 실제 리스너 인스턴스를 저장
        this.defaultRetriever.applicationListeners.add(listener);
        this.retrieverCache.clear();
    }
}
```

특징:
- 이미 생성된 리스너 인스턴스를 저장
- Spring 컨테이너와 무관하게 동작 가능
- 의존성 주입, AOP 등 Spring 혜택을 받지 못함
- 주 사용자: Spring 프레임워크 내부, 특수한 경우

사용 예시:
```kotlin
val context = AnnotationConfigApplicationContext()
val listener = MyListener()  // 직접 생성
context.addApplicationListener(listener)
```

### 2번 방식: addApplicationListenerBean(beanName) - 빈 이름 등록 (Lazy)

```java
public void addApplicationListenerBean(String listenerBeanName) {
    synchronized (this.defaultRetriever) {
        // 빈 이름(String)만 저장!
        this.defaultRetriever.applicationListenerBeans.add(listenerBeanName);
        this.retrieverCache.clear();
    }
}
```

특징:
- 리스너 빈 이름(String)만 저장
- Lazy Loading: 실제 이벤트 발생 시점에 Spring 컨테이너에서 빈 조회
- Spring이 관리하는 빈이므로 DI, AOP, 트랜잭션 등 모든 혜택 받음
- 주 사용자: 일반 애플리케이션 개발자

사용 예시:
```kotlin
@Component  // Spring이 관리
class MyListener : ApplicationListener<MyEvent> {
    @Autowired
    lateinit var someService: SomeService  // DI 가능!

    override fun onApplicationEvent(event: MyEvent) {
        someService.doSomething()
    }
}
```

### 왜 빈 이름으로 등록할까? Lazy Loading의 필요성

```kotlin
// refresh() 호출 순서
refresh() {
    // ...
    8. initApplicationEventMulticaster()    // 멀티캐스터 생성
    9. onRefresh()
    10. registerListeners()                 //  리스너 등록 (빈 이름만!)
    11. finishBeanFactoryInitialization()   //  싱글톤 빈 생성!
    12. finishRefresh()
}
```

문제: `registerListeners()`(10단계)는 싱글톤 빈이 생성되기 전(11단계)에 실행된다.

해결책: 10단계에서는 빈 이름만 등록하고, 실제 이벤트 발행 시(12단계 이후)에 빈을 조회한다.

### 비교 정리

| 구분 | `addApplicationListener` | `addApplicationListenerBean` |
|------|-------------------------|------------------------------|
| 저장 내용 | 리스너 인스턴스 (객체) | 빈 이름 (String) |
| 조회 시점 | 이미 있음 (Eager) | 이벤트 발행 시 (Lazy) |
| Spring DI | X 불가능 | O 가능 |
| AOP 적용 | X 불가능 | O 가능 |
| 실무 사용 | 거의 없음 | 표준 |

## 4. Early Events 메커니즘

### 문제 상황: "치킨과 달걀" 문제

Spring 컨텍스트 초기화 과정에서 타이밍 문제가 발생한다.

```kotlin
refresh() {
    1. prepareRefresh()                      // 준비 단계
    2-4. BeanFactory 관련 작업
    5. invokeBeanFactoryPostProcessors()     //  여기서 이벤트가 발생할 수 있음!
    6-7. 기타 초기화
    8. initApplicationEventMulticaster()     //  하지만 멀티캐스터는 여기서 생성됨!
    9. onRefresh()
    10. registerListeners()                  //  리스너는 여기서 등록됨!
    11-12. 완료
}
```

문제: 5번 단계에서 이벤트가 발생하는데, 이벤트를 발행할 멀티캐스터(8번)와 리스너(10번)가 아직 준비되지 않았다.

### 해결책: earlyApplicationEvents 버퍼

Spring은 이 문제를 임시 버퍼로 해결한다.

#### 1단계: 초기화 (prepareRefresh)

```java
protected void prepareRefresh() {
    // ...
    // earlyApplicationEvents 초기화
    if (this.earlyApplicationEvents == null) {
        this.earlyApplicationEvents = new LinkedHashSet<>();
    }
}
```

#### 2단계: 이벤트 저장 (publishEvent)

```java
protected void publishEvent(Object event, ResolvableType eventType) {
    // 이벤트 변환 로직...

    // 핵심 로직
    if (this.earlyApplicationEvents != null) {
        // 멀티캐스터가 아직 준비 안 됨 → 임시 저장!
        this.earlyApplicationEvents.add(applicationEvent);
    } else {
        // 멀티캐스터가 준비됨 → 즉시 발행
        getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
    }
}
```

#### 3단계: 저장된 이벤트 발행 (registerListeners)

```java
protected void registerListeners() {
    // 1. 리스너 등록
    // ...

    // 2. Early Events 발행
    Set<ApplicationEvent> earlyEventsToProcess = this.earlyApplicationEvents;
    this.earlyApplicationEvents = null;  // null로 설정 → 이제부터 즉시 발행 모드

    if (earlyEventsToProcess != null) {
        for (ApplicationEvent earlyEvent : earlyEventsToProcess) {
            // 이제 리스너들이 준비되었으므로 발행!
            getApplicationEventMulticaster().multicastEvent(earlyEvent);
        }
    }
}
```

### 타임라인 시각화

```
Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: prepareRefresh()
        └─> earlyApplicationEvents = new LinkedHashSet()

        [earlyApplicationEvents] = []
        [multicaster]            = null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 5: invokeBeanFactoryPostProcessors()
        │
        ├─> publishEvent(EarlyEvent)
        │   └─> earlyApplicationEvents.add(EarlyEvent)
        │
        [earlyApplicationEvents] = [EarlyEvent]
        [multicaster]            = null  ← 아직 없음!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 8: initApplicationEventMulticaster()
        │
        └─> multicaster = new SimpleApplicationEventMulticaster()

        [multicaster.listeners]  = []  ← 빈 상태

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 10: registerListeners()
         │
         ├─> 1. 리스너 등록
         │   [multicaster.listeners] = [Listener1, "listener2"]
         │
         └─> 2. Early Events 발행
                 multicastEvent(EarlyEvent)  ← 이제 발행!

        [earlyApplicationEvents] = null  ← 비움!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 12: finishRefresh()
         │
         └─> publishEvent(ContextRefreshedEvent)
             └─> multicastEvent()  ← 즉시 발행 (버퍼 없음)
```

### Early Events에 담기는 이벤트 예시

```kotlin
// 예시: BeanFactoryPostProcessor가 발행하는 이벤트
@Component
class CustomBeanFactoryPostProcessor : BeanFactoryPostProcessor {

    override fun postProcessBeanFactory(beanFactory: ConfigurableListableBeanFactory) {
        // 설정 검증
        validateConfiguration()

        // 이벤트 발행 (Early Event!)
        val context = beanFactory as? ApplicationContext
        context?.publishEvent(ConfigurationValidatedEvent())

        // 이 시점에는:
        // - applicationEventMulticaster가 아직 없음
        // - 리스너가 아직 등록 안 됨
        // → earlyApplicationEvents에 저장됨!
    }
}
```

## 5. ApplicationEventMulticaster: 실제 관리자

### 역할 분리: AbstractApplicationContext vs ApplicationEventMulticaster

`AbstractApplicationContext`는 이벤트 리스너를 직접 관리하지 않는다. 실제 관리는 `ApplicationEventMulticaster`에게 위임한다.

```
┌─────────────────────────────────────────────┐
│   AbstractApplicationContext               │
│   (조율자 - 전체 프로세스 관리)                │
│                                             │
│   - publishEvent() 요청 받음                │
│   - 실제 작업은 멀티캐스터에게 위임           │
└──────────────┬──────────────────────────────┘
               │ delegates to
               ▼
┌─────────────────────────────────────────────┐
│   ApplicationEventMulticaster               │
│   (실제 관리자 - 리스너 관리 및 이벤트 전파)    │
│                                             │
│    리스너 목록 저장 및 관리                  │
│    이벤트 발행 (멀티캐스트)                  │
└──────────────┬──────────────────────────────┘
               │ notifies
               ▼
┌─────────────────────────────────────────────┐
│   ApplicationListener (여러 개)              │
└─────────────────────────────────────────────┘
```

### AbstractApplicationContext의 구조

```java
public abstract class AbstractApplicationContext {

    //  멀티캐스터 참조 (소유만 하고 위임함)
    @Nullable
    private ApplicationEventMulticaster applicationEventMulticaster;

    // 정적 리스너 (임시 보관 후 멀티캐스터에 전달)
    private final Set<ApplicationListener<?>> applicationListeners = new LinkedHashSet<>();

    // Early Events 버퍼
    @Nullable
    private Set<ApplicationEvent> earlyApplicationEvents;
}
```

### SimpleApplicationEventMulticaster: 기본 구현체

```java
public class SimpleApplicationEventMulticaster implements ApplicationEventMulticaster {

    //  실제 리스너 저장소!
    private final DefaultListenerRetriever defaultRetriever = new DefaultListenerRetriever();

    // 성능 최적화를 위한 캐시
    private final Map<ListenerCacheKey, CachedListenerRetriever> retrieverCache;

    @Override
    public void multicastEvent(ApplicationEvent event, ResolvableType eventType) {
        ResolvableType type = (eventType != null ? eventType : ResolvableType.forInstance(event));
        Executor executor = getTaskExecutor();

        // 이벤트 타입에 맞는 리스너들을 찾아서 호출
        for (ApplicationListener<?> listener : getApplicationListeners(event, type)) {
            if (executor != null) {
                executor.execute(() -> invokeListener(listener, event));  // 비동기
            } else {
                invokeListener(listener, event);  // 동기
            }
        }
    }

    private void doInvokeListener(ApplicationListener listener, ApplicationEvent event) {
        listener.onApplicationEvent(event);  // 실제 호출!
    }
}
```

### 위임 패턴 (Delegation Pattern)

```java
// AbstractApplicationContext에서 위임
protected void publishEvent(Object event, ResolvableType eventType) {
    // ...
    if (this.earlyApplicationEvents != null) {
        this.earlyApplicationEvents.add(applicationEvent);
    } else {
        //  멀티캐스터에게 위임!
        getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
    }
}

protected void registerListeners() {
    // 1. 정적 리스너 등록 → 위임
    for (ApplicationListener<?> listener : getApplicationListeners()) {
        getApplicationEventMulticaster().addApplicationListener(listener);
    }

    // 2. 빈 리스너 등록 → 위임
    for (String listenerBeanName : listenerBeanNames) {
        getApplicationEventMulticaster().addApplicationListenerBean(listenerBeanName);
    }

    // 3. Early Events 발행 → 위임
    for (ApplicationEvent earlyEvent : earlyEventsToProcess) {
        getApplicationEventMulticaster().multicastEvent(earlyEvent);
    }
}
```

### 왜 이렇게 분리했을까? (SOLID 원칙)

```kotlin
// X 만약 AbstractApplicationContext가 직접 관리한다면?
abstract class AbstractApplicationContext {
    private val listeners = mutableListOf<ApplicationListener<*>>()

    fun publishEvent(event: ApplicationEvent) {
        // 이벤트 타입 검사
        // 리스너 필터링
        // 순서 정렬
        // 비동기 처리
        // 에러 핸들링
        // 트랜잭션 처리
        // ... 책임이 너무 많아짐!
    }
}

// O 역할 분리
abstract class AbstractApplicationContext {
    private val multicaster: ApplicationEventMulticaster  // 위임!

    fun publishEvent(event: ApplicationEvent) {
        multicaster.multicastEvent(event)  // 간단!
    }
}
```

### 누가 뭘 관리하는가?

| 컴포넌트 | 역할 | 관리하는 것 |
|---------|------|----------|
| AbstractApplicationContext | 조율자 | - 멀티캐스터 참조<br>- 정적 리스너 임시 보관<br>- Early Events 버퍼 |
| ApplicationEventMulticaster | 실제 관리자 | - 리스너 목록 저장<br>- 이벤트 발행<br>- 리스너 필터링<br>- 비동기 처리 |
| ApplicationListener | 처리자 | - 실제 이벤트 처리 로직 |

## 6. 이벤트 타입 매칭과 필터링

### 이벤트는 모든 리스너에게 전달되는가?

그렇지 않다. 이벤트 타입에 매칭되는 리스너만 실행된다.

### ApplicationListener의 제네릭 구조

```kotlin
@FunctionalInterface
interface ApplicationListener<E : ApplicationEvent> : EventListener {
    /**
     * E: 이 리스너가 관심있는 이벤트 타입!
     */
    fun onApplicationEvent(event: E)
}
```

### 리스너별 관심 이벤트 선언

```kotlin
// 리스너 1: ProjectCreatedEvent에만 관심
@Component
class ProjectCreatedListener : ApplicationListener<ProjectCreatedEvent> {
    override fun onApplicationEvent(event: ProjectCreatedEvent) {
        println("프로젝트 생성됨: ${event.projectId}")
    }
}

// 리스너 2: ProjectDeletedEvent에만 관심
@Component
class ProjectDeletedListener : ApplicationListener<ProjectDeletedEvent> {
    override fun onApplicationEvent(event: ProjectDeletedEvent) {
        println("프로젝트 삭제됨: ${event.projectId}")
    }
}

// 리스너 3: 모든 ApplicationEvent에 관심
@Component
class ApplicationEventLogger : ApplicationListener<ApplicationEvent> {
    override fun onApplicationEvent(event: ApplicationEvent) {
        println("이벤트 발생: ${event.javaClass.simpleName}")
    }
}
```

### multicastEvent()의 타입 필터링 로직

```java
// SimpleApplicationEventMulticaster.java
public void multicastEvent(ApplicationEvent event, ResolvableType eventType) {
    ResolvableType type = (eventType != null ? eventType : ResolvableType.forInstance(event));

    //  1단계: 이벤트 타입에 맞는 리스너만 필터링!
    Collection<ApplicationListener<?>> listeners = getApplicationListeners(event, type);

    // 2단계: 필터링된 리스너들만 실행
    for (ApplicationListener<?> listener : listeners) {
        invokeListener(listener, event);
    }
}

protected Collection<ApplicationListener<?>> getApplicationListeners(
        ApplicationEvent event, ResolvableType eventType) {

    List<ApplicationListener<?>> filteredListeners = new ArrayList<>();

    for (ApplicationListener<?> listener : allListeners) {
        //  핵심: 타입 체크!
        if (supportsEvent(listener, eventType, sourceType)) {
            filteredListeners.add(listener);
        }
    }

    return filteredListeners;
}

/**
 *  핵심 메서드: 리스너가 이 이벤트를 처리할 수 있는지 확인
 */
protected boolean supportsEvent(
        ApplicationListener<?> listener,
        ResolvableType eventType,
        @Nullable Class<?> sourceType) {

    // 1. 제네릭 타입 추출: ApplicationListener<E>의 E 추출
    ResolvableType declaredEventType = resolveDeclaredEventType(listener);

    // 2. 타입 매칭 확인
    return (declaredEventType == null ||  // 모든 이벤트 허용
            declaredEventType.isAssignableFrom(eventType) ||  // 부모 타입
            eventType.isAssignableFrom(declaredEventType));   // 자식 타입
}
```

### 실제 동작 시나리오

```kotlin
// 이벤트 계층 구조
open class ApplicationEvent(source: Any)
    ↑
    └─ ProjectEvent (추상)
           ↑
           ├─ ProjectCreatedEvent
           └─ ProjectDeletedEvent

// 등록된 리스너들
val listeners = listOf(
    ProjectCreatedListener(),    // ApplicationListener<ProjectCreatedEvent>
    ProjectDeletedListener(),    // ApplicationListener<ProjectDeletedEvent>
    ApplicationEventLogger(),    // ApplicationListener<ApplicationEvent>
)

// ProjectCreatedEvent 발행
context.publishEvent(ProjectCreatedEvent(projectId = "p1"))

// multicastEvent() 내부 동작:
// 1. ProjectCreatedListener
//    - 제네릭 타입: ProjectCreatedEvent
//    - 발행된 이벤트: ProjectCreatedEvent
//    - 매칭: O YES → 호출!

// 2. ProjectDeletedListener
//    - 제네릭 타입: ProjectDeletedEvent
//    - 발행된 이벤트: ProjectCreatedEvent
//    - 매칭: X NO → 건너뜀

// 3. ApplicationEventLogger
//    - 제네릭 타입: ApplicationEvent (부모 타입)
//    - 발행된 이벤트: ProjectCreatedEvent (자식 타입)
//    - 매칭: O YES → 호출! (상속 관계)

// 결과: ProjectCreatedListener, ApplicationEventLogger만 실행됨!
```

### 타입 매칭 규칙

```kotlin
// 이벤트 계층 구조
ApplicationEvent
    ↑
    ├─ ContextRefreshedEvent
    └─ ProjectEvent
            ↑
            ├─ ProjectCreatedEvent
            └─ ProjectDeletedEvent

// ProjectCreatedEvent 발행 시 매칭 결과:

ApplicationListener<ApplicationEvent>
→ O 매칭 (모든 이벤트의 부모)

ApplicationListener<ProjectEvent>
→ O 매칭 (직계 부모)

ApplicationListener<ProjectCreatedEvent>
→ O 매칭 (정확히 일치)

ApplicationListener<ProjectDeletedEvent>
→ X 불일치 (형제 타입)

ApplicationListener<ContextRefreshedEvent>
→ X 불일치 (다른 계층)
```

### @EventListener 애노테이션의 경우

```kotlin
@Component
class MyHandler {

    @EventListener
    fun handle(event: ProjectCreatedEvent) {  //  파라미터 타입으로 판단
        // ...
    }
}

// Spring이 내부적으로 이렇게 변환:
class MyHandler$handle$Adapter : ApplicationListener<ProjectCreatedEvent> {
    override fun onApplicationEvent(event: ProjectCreatedEvent) {
        myHandler.handle(event)
    }
}
```

## 7. 전체 흐름 정리

### registerListeners()의 3단계와 Early Events의 관계

```java
protected void registerListeners() {

    //  1단계: 정적 리스너 등록
    for (ApplicationListener<?> listener : getApplicationListeners()) {
        getApplicationEventMulticaster().addApplicationListener(listener);
    }
    // 멀티캐스터 상태: [Listener1, Listener2] 등록 완료

    //  2단계: 빈 리스너 등록
    String[] listenerBeanNames = getBeanNamesForType(ApplicationListener.class);
    for (String listenerBeanName : listenerBeanNames) {
        getApplicationEventMulticaster().addApplicationListenerBean(listenerBeanName);
    }
    // 멀티캐스터 상태: [Listener1, Listener2, "listener3", "listener4"] 등록 완료

    //  3단계: Early Events 발행 → 방금 등록한 리스너들에게 전달!
    Set<ApplicationEvent> earlyEventsToProcess = this.earlyApplicationEvents;
    this.earlyApplicationEvents = null;
    if (earlyEventsToProcess != null) {
        for (ApplicationEvent earlyEvent : earlyEventsToProcess) {
            // 1, 2단계에서 등록한 리스너들이 이제 이 이벤트를 받음!
            getApplicationEventMulticaster().multicastEvent(earlyEvent);
        }
    }
}
```

### 흐름 다이어그램

``` text
사용자 코드
    ↓
┌─────────────────────────────────────────┐
│ context.publishEvent(event)             │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ AbstractApplicationContext              │
│                                         │
│ if (earlyApplicationEvents != null)     │
│   earlyApplicationEvents.add(event)     │ ← Step 5에서
│ else                                    │
│   multicaster.multicastEvent(event) ────┼─→ Step 10 이후
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ ApplicationEventMulticaster             │
│                                         │
│ 1. getApplicationListeners(event, type) │ ← 타입 필터링
│ 2. for each listener:                   │
│      listener.onApplicationEvent(event) │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ ApplicationListener 구현체들             │
│ - ProjectCreatedListener                │
│ - ApplicationEventLogger                │
│ - ...                                   │
└─────────────────────────────────────────┘
```

### refresh() 메서드의 전체 타임라인

| 단계 | 메서드 | earlyApplicationEvents | 멀티캐스터 | 리스너 |
|------|--------|----------------------|----------|-------|
| 1 | prepareRefresh() | `[]` 생성 | null | - |
| 5 | invokeBeanFactoryPostProcessors() | `[Event1]` 저장 | null | - |
| 8 | initApplicationEventMulticaster() | `[Event1]` | 생성됨 (리스너 없음) | - |
| 10-1 | registerListeners() - 정적 | `[Event1]` | `[L1, L2]` | 2개 |
| 10-2 | registerListeners() - 빈 | `[Event1]` | `[L1, L2, "l3"]` | 3개 |
| 10-3 | registerListeners() - Early | `null` (비움!) | `[L1, L2, "l3"]` | Event1 발행! |
| 12 | finishRefresh() | `null` | `[L1, L2, "l3"]` | 즉시 발행 |

## 결론

Spring의 이벤트 시스템을 분석한 결과, 겉으로 보기에는 단순해 보이지만 내부적으로는 정교한 메커니즘으로 동작하고 있었다.

### 주요 내용 정리

1. AbstractApplicationContext
   - Spring 컨텍스트 그 자체
   - `refresh()` 메서드로 12단계 초기화 프로세스 관리
   - 이벤트 리스너를 직접 관리하지 않고 `ApplicationEventMulticaster`에게 위임

2. registerListeners()의 3단계
   - 1단계: 정적 리스너 인스턴스 등록
   - 2단계: 빈 리스너 이름 등록 (Lazy Loading)
   - 3단계: Early Events 발행

3. 두 가지 리스너 등록 방식
   - `addApplicationListener(listener)`: 인스턴스 직접 등록 (프레임워크 내부용)
   - `addApplicationListenerBean(beanName)`: 빈 이름 등록 (일반 개발자용)

4. Early Events 메커니즘
   - 멀티캐스터/리스너 준비 전에 발생한 이벤트를 임시 저장
   - `registerListeners()`에서 저장된 이벤트를 발행
   - 이벤트 누락 방지

5. ApplicationEventMulticaster
   - 실제 리스너 관리 및 이벤트 발행 담당
   - 타입 기반 리스너 필터링
   - 비동기/동기 실행 지원

6. 이벤트 타입 매칭
   - 제네릭 타입으로 관심 이벤트 선언
   - `supportsEvent()` 메서드로 타입 체크
   - 상속 관계도 지원 (부모 타입 리스너가 자식 이벤트 수신 가능)

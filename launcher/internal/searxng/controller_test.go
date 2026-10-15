package searxng

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testService struct{ stops atomic.Int32 }

func (s *testService) URL() string { return "http://127.0.0.1:49152" }
func (s *testService) Stop()       { s.stops.Add(1) }

func TestControllerOptInAndStopsBeforeReturning(t *testing.T) {
	service := &testService{}
	var starts atomic.Int32
	controller := NewController(func(context.Context) (ManagedService, error) {
		starts.Add(1)
		return service, nil
	})
	defer controller.Close()

	if status := controller.Configure(false); status.Status != "disabled" || starts.Load() != 0 {
		t.Fatalf("default started resources: %+v", status)
	}

	controller.Configure(true)
	deadline := time.Now().Add(time.Second)
	for controller.Current().Status == "starting" && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	if status := controller.Current(); status.Status != "ready" || status.URL != service.URL() {
		t.Fatalf("not ready: %+v", status)
	}

	controller.Configure(true)
	controller.Configure(false)
	if starts.Load() != 1 || service.stops.Load() != 1 {
		t.Fatalf("starts=%d stops=%d; want one of each", starts.Load(), service.stops.Load())
	}
}

func TestControllerCancelsInstallationAndCanReenable(t *testing.T) {
	var starts atomic.Int32
	controller := NewController(func(ctx context.Context) (ManagedService, error) {
		starts.Add(1)
		<-ctx.Done()

		return nil, ctx.Err()
	})
	defer controller.Close()

	for i := 0; i < 2; i++ {
		controller.Configure(true)
		if status := controller.Configure(false); status.Status != "disabled" {
			t.Fatalf("not disabled: %+v", status)
		}
	}
	if starts.Load() != 2 {
		t.Fatalf("starts=%d; want 2", starts.Load())
	}
}

func TestControllerReportsFailureWithoutRepeatedInstallAttempts(t *testing.T) {
	var starts atomic.Int32
	controller := NewController(func(context.Context) (ManagedService, error) {
		starts.Add(1)

		return nil, errors.New("Python unavailable")
	})
	defer controller.Close()
	controller.Configure(true)
	deadline := time.Now().Add(time.Second)
	for controller.Current().Status == "starting" && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	if status := controller.Configure(true); status.Status != "error" || status.Message == "" || starts.Load() != 1 {
		t.Fatalf("failure state: %+v; starts=%d", status, starts.Load())
	}
}

func TestControllerCannotRestartAfterClose(t *testing.T) {
	var starts atomic.Int32
	controller := NewController(func(context.Context) (ManagedService, error) {
		starts.Add(1)

		return &testService{}, nil
	})
	controller.Close()
	controller.Configure(true)
	if starts.Load() != 0 || controller.Current().Status != "disabled" {
		t.Fatal("closed controller restarted a worker")
	}
}

func TestControllerStopsWorkerThatFinishesStartingDuringCancellation(t *testing.T) {
	service := &testService{}
	controller := NewController(func(ctx context.Context) (ManagedService, error) {
		<-ctx.Done()

		return service, nil
	})
	defer controller.Close()
	controller.Configure(true)
	controller.Configure(false)

	if service.stops.Load() != 1 || controller.Current().Status != "disabled" {
		t.Fatal("worker leaked when startup completed after cancellation")
	}
}

func TestControllerConcurrentTogglesAndShutdownLeaveNoWorkers(t *testing.T) {
	var starts, stops atomic.Int32
	started := make(chan struct{}, 64)
	controller := NewController(func(context.Context) (ManagedService, error) {
		starts.Add(1)
		started <- struct{}{}

		return &countedService{stops: &stops}, nil
	})
	controller.Configure(true)
	<-started

	var group sync.WaitGroup
	for i := 0; i < 30; i++ {
		group.Add(1)
		go func(enabled bool) {
			defer group.Done()
			controller.Configure(enabled)
		}(i%2 == 0)
	}
	controller.Close()
	group.Wait()

	if controller.Current().Status != "disabled" || starts.Load() != stops.Load() {
		t.Fatalf("state=%+v starts=%d stops=%d", controller.Current(), starts.Load(), stops.Load())
	}
}

type countedService struct{ stops *atomic.Int32 }

func (s *countedService) URL() string { return "http://127.0.0.1:49152" }
func (s *countedService) Stop()       { s.stops.Add(1) }

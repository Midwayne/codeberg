package searxng

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestControlRequiresPrivateTokenAndValidChanges(t *testing.T) {
	controller := NewController(func(ctx context.Context) (ManagedService, error) {
		<-ctx.Done()

		return nil, ctx.Err()
	})
	server, err := ListenControl(controller)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	cases := []struct {
		token, origin, body string
		want                int
	}{
		{"", "", `{"enabled":true}`, http.StatusUnauthorized},
		{server.Token, "https://other.example", `{"enabled":true}`, http.StatusUnauthorized},
		{server.Token, "", `{"enabled":"false"}`, http.StatusBadRequest},
		{server.Token, "", `{broken`, http.StatusBadRequest},
		{server.Token, "", `{"enabled":true} trailing`, http.StatusBadRequest},
		{server.Token, "", `{"enabled":true}{"enabled":false}`, http.StatusBadRequest},
		{server.Token, "", `{"enabled":true}` + strings.Repeat(" ", 2048), http.StatusBadRequest},
		{server.Token, "", `{"enabled":true}`, http.StatusOK},
		{server.Token, "", `{"enabled":false}`, http.StatusOK},
	}
	for _, test := range cases {
		req, _ := http.NewRequest(http.MethodPut, server.URL, strings.NewReader(test.body))
		req.Header.Set("Authorization", "Bearer "+test.token)
		req.Header.Set("Origin", test.origin)
		req.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.want {
			t.Fatalf("status=%d; want %d", response.StatusCode, test.want)
		}
		if test.want != http.StatusOK && controller.Current().Status != "disabled" {
			t.Fatal("rejected request started the worker")
		}
	}
	if controller.Current().Status != "disabled" {
		t.Fatal("worker remained enabled")
	}
}

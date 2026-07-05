package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

var (
	ErrUnknownTool = errors.New("codeberg: unknown tool")
	ErrInvalidArgs = errors.New("codeberg: invalid tool arguments")
)

type Spec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema"`
}

type Tool interface {
	Spec() Spec
	Call(ctx context.Context, args json.RawMessage) (any, error)
}

func New[T any](name, description, schema string, fn func(ctx context.Context, args T) (any, error)) Tool {
	return &typedTool[T]{
		spec: Spec{Name: name, Description: description, Schema: json.RawMessage(schema)},
		fn:   fn,
	}
}

type typedTool[T any] struct {
	spec Spec
	fn   func(ctx context.Context, args T) (any, error)
}

func (t *typedTool[T]) Spec() Spec { return t.spec }

func (t *typedTool[T]) Call(ctx context.Context, raw json.RawMessage) (any, error) {
	var args T
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, fmt.Errorf("%w: %s: %v", ErrInvalidArgs, t.spec.Name, err)
		}
	}
	return t.fn(ctx, args)
}

type Registry struct {
	order  []string
	byName map[string]Tool
}

func NewRegistry() *Registry {
	return &Registry{byName: make(map[string]Tool)}
}

func (r *Registry) Register(t Tool) {
	name := t.Spec().Name
	if _, ok := r.byName[name]; !ok {
		r.order = append(r.order, name)
	}
	r.byName[name] = t
}

func (r *Registry) List() []Spec {
	specs := make([]Spec, 0, len(r.order))
	for _, name := range r.order {
		specs = append(specs, r.byName[name].Spec())
	}
	return specs
}

func (r *Registry) Call(ctx context.Context, name string, args json.RawMessage) (any, error) {
	t, ok := r.byName[name]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTool, name)
	}
	return t.Call(ctx, args)
}

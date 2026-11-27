/* A new chat shows only a greeting above the composer, with nothing to choose. */
export function ChatEmptyState() {
  return (
    <div className="mx-auto w-full max-w-2xl px-2 pb-2 text-center">
      <h1 className="text-3xl font-normal tracking-tight text-balance text-foreground sm:text-4xl">
        What do you want to know?
      </h1>
    </div>
  );
}

export type SuccessNoticeProps = { message: string; sizingText: string };

/** The hidden sizer reserves wrapped lines without announcing a pending success. */
export function SuccessNotice({ message, sizingText }: SuccessNoticeProps) {
  return (
    <div className="grid min-h-5 break-words text-sm">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {sizingText}
      </span>
      <p role="status" className="ui-success col-start-1 row-start-1" data-present={Boolean(message)}>
        {message}
      </p>
    </div>
  );
}

"""Fixed texts embedded by both runtimes to prove a conversion kept the model."""

QUERIES = [
    "where do we retry failed payment captures",
    "function that validates a JWT and returns the user id",
    "how is the cache invalidated after a deploy",
]

DOCUMENTS = [
    "def capture(payment):\n    for attempt in range(3):\n        if gateway.capture(payment):\n"
    "            return True\n        time.sleep(2 ** attempt)\n    return False\n",
    "func ParseToken(raw string) (string, error) {\n\tclaims, err := verify(raw)\n"
    "\tif err != nil {\n\t\treturn \"\", err\n\t}\n\treturn claims.Subject, nil\n}\n",
    "## Cache invalidation\nEvery deploy bumps the cache namespace so old entries expire.",
]

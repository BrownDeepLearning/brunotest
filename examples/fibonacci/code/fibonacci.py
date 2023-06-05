"""
This file contains the code for the fibonacci example.
"""


def fibonacci(n: int) -> int:
    """
    Computes and returns the nth Fibonacci number.
    """
    ### Region: fibonacci.call
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
    ### EndRegion


def factorial(n: int) -> int:
    """
    Computes and returns the factorial of n.
    """
    ### Region: factorial.call
    if n == 0:
        return 1
    return n * factorial(n - 1)
    ### EndRegion

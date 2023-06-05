"""
Contains the test cases for the fibonacci example.
"""

import unittest
from gradescope_utils.autograder_utils.decorators import number, weight
from brunotest import import_solution_module, import_student_module


class TestFibonacci(unittest.TestCase):
    """
    Tests the `fibonacci` function.
    """

    @number("1")
    @weight(25)
    def test_base_cases(self):
        """
        Base case values are correct
        """
        student_fibonacci = import_student_module("fibonacci")
        self.assertEqual(student_fibonacci.fibonacci(0), 0)
        self.assertEqual(student_fibonacci.fibonacci(1), 1)
        print("Base cases are correct!")

    @number("2")
    @weight(75)
    def test_general(self):
        """
        General computation cases for fibonacci are correct
        """
        student_fibonacci = import_student_module("fibonacci")
        solution_fibonacci = import_solution_module("fibonacci")

        print(student_fibonacci, solution_fibonacci)

        for i in range(0, 12):
            self.assertEqual(
                student_fibonacci.fibonacci(i), solution_fibonacci.fibonacci(i)
            )

        print("General cases are correct!")

    @number("2")
    @weight(75)
    def test_always_passes(self):
        """
        General computation cases for fibonacci are correct
        """
        print("Test passed!")

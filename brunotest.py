"""
This module contains core logic for the brunotest CLI appliance.
"""

from dataclasses import dataclass
import os
import shutil
from typing import Optional
import click
import pytest
from core import compiler, imports

BRUNOTEST_DIR = "__brunotest__"
CODE_DIR = "code"


def import_student_module(module_name: str):
    """
    Import a student's module and return it.
    Must be compatible with how this works on gradescopes end.

    In the autograder, student code is imported as follows:
    "/autograder/student"
    """
    module_path = os.path.join("student", *module_name.split(".")) + ".py"
    # Import the solution's module
    student_module = imports.import_module_without_cache(module_name, module_path)

    return student_module


def import_solution_module(module_name: str):
    """
    Import a solution's module and return it.
    Must be compatible with how this works on gradescopes end.

    In the autograder, student code is imported as follows:
    "/autograder/solution"
    """

    module_path = os.path.join("solution", *module_name.split(".")) + ".py"
    # Import the solution's module
    solution_module = imports.import_module_without_cache(module_name, module_path)

    return solution_module


def remove_all(path: str, remove_dir: bool = True) -> None:
    """
    Removes all files and directories in the given path.
    """
    for root, dirs, files in os.walk(path, topdown=False):
        for file in files:
            os.remove(os.path.join(root, file))
        for directory in dirs:
            shutil.rmtree(os.path.join(root, directory))

    if remove_dir and os.path.isdir(path):
        os.rmdir(path)


def create_brunotest_dir():
    """
    Makes a directory called `__brunotest__` in the current working directory.
    """
    # Make a directory in the current working directory called __brunotest__

    # Enter the directory
    if not os.path.isdir(BRUNOTEST_DIR):
        os.mkdir(BRUNOTEST_DIR)

    # Remove any existing files in the directory
    remove_all(BRUNOTEST_DIR, False)


def cleanup_brunotest_dir():
    """
    Deletes the `__brunotest__` directory in the current working directory.
    """
    # Delete the directory
    remove_all(BRUNOTEST_DIR)


def find_stencil(directory: str) -> str:
    """
    Attempts to find the stencil file in the main root of the directory.
    """
    entries = os.listdir(directory)
    stencil_entries = [entry for entry in entries if entry.endswith(".stencil")]

    if len(stencil_entries) == 0:
        raise FileNotFoundError("No stencil file found in the root of the directory.")
    if len(stencil_entries) > 1:
        raise FileNotFoundError(
            "Multiple stencil files found in the root of the directory."
        )

    return os.path.join(directory, stencil_entries[0])


def find_chaff_paths(directory: str) -> list[str]:
    """
    Iterates through the entire subdirectory to find all chaff files.
    """
    chaff_paths = []

    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".chaff"):
                chaff_paths.append(os.path.join(root, file))

    return chaff_paths


def compile_to_directory(
    code_path: str, chaff_path: Optional[str], output_directory: str
) -> None:
    """
    Compiles all of the template files from `code_path` to the specified output directory.
    Should maintain folder structure and walk through all subdirectories
    """
    chaff_replacements = compiler.read_chaff_file(chaff_path)

    for root, dirs, files in os.walk(code_path):
        for directory in dirs:
            # Make the directory in the output directory
            os.mkdir(os.path.join(output_directory, directory))
        for file in files:
            compiler.compile_file(
                os.path.join(root, file),
                os.path.join(output_directory, file),
                chaff_replacements,
            )


FAILURE_PREFIX = "### Fails:"
FAILURE_PREFIX_LEN = len(FAILURE_PREFIX)


def get_chaff_expected_test_failures(chaff_path: Optional[str]) -> set[str]:
    """
    Reads the chaff file and returns a set of all of the expected test failures.

    Args:
        chafF_path (str): The path to the chaff file.

    Returns:
        set[str]: A set of all of the expected test failures.
    """
    if chaff_path is None:
        # Is the solution, in which case there are no expected test failures
        return set()

    print(chaff_path)
    # Read the chaff file
    with open(chaff_path, "r", encoding="utf-8") as file:
        chaff_lines = file.readlines()

    expected_test_failures = set()

    for line in chaff_lines:
        if line.startswith(FAILURE_PREFIX):
            expected_test_failures.add(line[FAILURE_PREFIX_LEN:].strip())

    return expected_test_failures


class BrunotestPytestPlugin:
    """
    Custom pytest plugin that stores the test outputs and stdout for each test.

    Also keeps track of which tests passed and which tests failed.
    """

    def __init__(
        self,
    ):
        self.test_outputs = {}
        self.test_stdout = {}
        self.passed_tests = set()
        self.failed_tests = set()

    def get_test_name(self, complete_name):
        """
        Isolates the path of the test file from the test name.
        """
        return complete_name.split(".py::")[-1]

    def pytest_runtest_logreport(self, report) -> None:
        """
        Callback for various events in the pytest run.

        We only care about the call event, which is when the test is actually run,
        but there are also the setup and teardown events.
        """
        if report.when == "call":
            test_name = self.get_test_name(report.nodeid)
            if report.passed:
                self.passed_tests.add(test_name)
            else:
                self.failed_tests.add(test_name)

            self.test_stdout[test_name] = report.capstdout

            if report.longrepr is not None:
                self.test_outputs[test_name] = str(report.longrepr)
            else:
                self.test_outputs[test_name] = ""


@dataclass
class BrunotestAutograderResult:
    """
    Represents the result of trying to run the autograder on a particular chaff.
    """

    passed: bool
    chaff_name: str
    tests_failed_unexpectedly: set[str]
    tests_passed_unexpectedly: set[str]
    test_details: dict[str, str]
    test_stdout: dict[str, str]


def simulate_autograder(
    absolute_chaff_path: Optional[str],
    chaff_name: str,
    absolute_solution_path: str,
    absolute_path_to_tests: str,
) -> BrunotestAutograderResult:
    """
    Simulates the autograder, running the tests on the chaff
    and checking if the expected tests fail.
    """
    current_dir = os.path.abspath(os.getcwd())
    absolute_brunotest_dir = os.path.abspath(BRUNOTEST_DIR)
    autograder_path = os.path.join(absolute_brunotest_dir, "autograder")
    os.mkdir(autograder_path)

    os.chdir(autograder_path)

    # Copy the solution directory to the autograder
    shutil.copytree(absolute_solution_path, "solution")

    # Compile the chaff code to the autograder folder
    student_directory = os.path.join(autograder_path, "student")

    if chaff_name == "solution":
        # If the chaff is the solution, then just copy the solution directory
        shutil.copytree(absolute_solution_path, student_directory)
    else:
        os.mkdir(student_directory)
        compile_to_directory(
            absolute_solution_path,
            absolute_chaff_path,
            student_directory,
        )

    expected_failures = get_chaff_expected_test_failures(absolute_chaff_path)

    # Once it is compiled, run the tests.

    testing_plugin = BrunotestPytestPlugin()
    pytest.main(
        ["-q", "--color=yes", absolute_path_to_tests, "--full-trace"],
        plugins=[testing_plugin],
    )

    tests_passed_unexpectedly = set.intersection(
        expected_failures, testing_plugin.passed_tests
    )

    tests_failed_unexpectedly = set.difference(
        testing_plugin.failed_tests, expected_failures
    )

    passed = len(tests_passed_unexpectedly) == 0 and len(tests_failed_unexpectedly) == 0
    result = BrunotestAutograderResult(
        passed,
        chaff_name,
        tests_failed_unexpectedly,
        tests_passed_unexpectedly,
        testing_plugin.test_outputs,
        testing_plugin.test_stdout,
    )

    os.chdir(current_dir)

    # Clean up the autograder structure for this run
    remove_all(autograder_path)

    return result


def summarize_test_result(autograder_test: BrunotestAutograderResult) -> None:
    """
    Summarizes the given autograder result to the console.
    """
    if autograder_test.passed:
        click.echo(
            click.style(
                f"Chaff {autograder_test.chaff_name} behaved as expected!",
                fg="green",
            )
        )
    else:
        # Tell the user how the test failed
        click.echo(
            click.style(
                f"Chaff {autograder_test.chaff_name} failed!",
                fg="red",
            )
        )

        # Tell the user which tests failed unexpectedly
        for unexpected_failure in autograder_test.tests_failed_unexpectedly:
            click.echo(
                click.style(
                    f"{autograder_test.chaff_name}: {unexpected_failure} failed unexpectedly...",
                    fg="blue",
                    bold=True,
                )
            )
            click.echo(click.style(autograder_test.test_details[unexpected_failure]))

            click.echo(click.style("Standard Output: ", fg="yellow", bold=True))
            click.echo(autograder_test.test_stdout[unexpected_failure])

        # Tell the user which tests passed unexpectedly
        for unexpected_success in autograder_test.tests_passed_unexpectedly:
            click.echo(
                click.style(
                    f"{autograder_test.chaff_name}: {unexpected_success} passed unexpectedly...",
                    fg="blue",
                    bold=True,
                )
            )
            click.echo(click.style("Standard Output: ", fg="yellow", bold=True))
            click.echo(autograder_test.test_stdout[unexpected_success])


@click.command()
@click.argument("chaffs", nargs=-1)
@click.option("--directory", "--dir", "-d", type=click.Path(exists=True))
@click.option("--run_all", "-a", is_flag=True, help="Run all chaffs", default=False)
@click.option(
    "compile_dir",
    "-c",
    type=click.Path(),
    help="The directory to compile and output the results to",
)
def brunotest_cli_entry(  # pylint: disable=too-many-locals
    chaffs: list[str], directory: str, compile_dir: Optional[str], run_all: bool
):
    """
    The entry point for the brunotest command line executable.
    """

    stencil_path = find_stencil(directory)
    chaff_paths = find_chaff_paths(directory)
    chaff_names = [
        os.path.basename(chaff_path).split(".")[0] for chaff_path in chaff_paths
    ]
    chaff_path_name: list[tuple[Optional[str], str]] = (
        list(zip(chaff_paths, chaff_names))
        + [(stencil_path, "stencil")]
        + [(None, "solution")]
    )

    # Select only the chaffs we have in chaffs
    chaff_path_name = [
        (chaff_path, chaff_name)
        for chaff_path, chaff_name in chaff_path_name
        if (chaff_name in chaffs or run_all)
    ]

    if len(chaff_path_name) == 0:
        raise FileNotFoundError("No chaffs specified.")

    if compile_dir is not None:
        # Only compile the code, don't run any tests.
        # Compile all of the code to the paths specified in `chaffs`
        os.mkdir(compile_dir)
        for chaff_path, chaff_name in chaff_path_name:
            os.mkdir(os.path.join(compile_dir, chaff_name))
            if chaff_path is not None:
                compile_to_directory(
                    os.path.join(directory, "code"),
                    chaff_path,
                    os.path.join(compile_dir, chaff_name),
                )
            else:
                # Copy the solution to the compile directory
                shutil.copytree(
                    os.path.join(directory, "code"),
                    os.path.join(compile_dir, chaff_name),
                )

        click.echo(
            click.style(
                f"Compiled {len(chaff_path_name)} solutions to '{compile_dir}'",
                fg="green",
            )
        )
        return

    create_brunotest_dir()
    original_dir = os.path.abspath(os.getcwd())
    absolute_solution_path = os.path.abspath(os.path.join(directory, "code"))
    absolute_test_path = os.path.abspath(os.path.join(directory, "tests"))
    try:
        # Compile all of the specified chaffs to the testing directory
        test_results = []
        for chaff_path, chaff_name in chaff_path_name:
            absolute_chaff_path = (
                os.path.abspath(chaff_path) if chaff_path is not None else None
            )
            autograder_result = simulate_autograder(
                absolute_chaff_path,
                chaff_name,
                absolute_solution_path,
                absolute_test_path,
            )

            test_results.append(autograder_result)

        # Output the results to the user
        for test_result in test_results:
            summarize_test_result(test_result)

        cleanup_brunotest_dir()
    except Exception as exception:
        os.chdir(original_dir)
        cleanup_brunotest_dir()
        raise exception


if __name__ == "__main__":
    brunotest_cli_entry(None, None, None, None)  # type: ignore

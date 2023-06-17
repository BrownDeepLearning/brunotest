"""
Setup for the `brunotest` package.
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = fh.read()

setup(
    name="brunotest",
    version="0.1.1",
    author="Brown Deep Learning Staff",
    author_email="cs1470htas@brown.edu",
    license="MIT",
    description="CLI tool for robust autograder chaff testing",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Brown-Deep-Learning/brunotest",
    py_modules=["brunotest"],
    packages=find_packages(),
    install_requires=[requirements],
    python_requires=">=3.10",
    classifiers=[
        "Programming Language :: Python :: 3.10",
        "Operating System :: OS Independent",
    ],
    entry_points="""
        [console_scripts]
        brunotest=brunotest:brunotest_cli_entry
    """,
)

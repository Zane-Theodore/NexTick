import unittest

from data_pipeline.producer.depth_normalization import normalize_binance_depth_record
from data_pipeline.producer.trade_normalization import normalize_binance_trade_record


class BinanceCombinedTradeProducerTests(unittest.TestCase):
    def test_normalize_depth_preserves_top_levels(self):
        record = normalize_binance_depth_record(
            {
                "stream": "btcusdt@depth20@100ms",
                "data": {
                    "lastUpdateId": 456,
                    "bids": [["105120.1", "0.125"]],
                    "asks": [["105121.2", "0.25"]],
                },
            },
            ["btcusdt"],
        )

        self.assertEqual(
            record,
            {
                "symbol": "BTCUSDT",
                "last_update_id": 456,
                "bids": [[105120.1, 0.125]],
                "asks": [[105121.2, 0.25]],
            },
        )

    def test_normalize_depth_rejects_invalid_levels(self):
        record = normalize_binance_depth_record(
            {
                "stream": "btcusdt@depth20@100ms",
                "data": {
                    "lastUpdateId": 456,
                    "bids": [["105120.1", "0"]],
                    "asks": [["105121.2", "0.25"]],
                },
            },
            ["btcusdt"],
        )

        self.assertIsNone(record)

    def test_normalize_trade_preserves_buyer_maker_flag(self):
        record = normalize_binance_trade_record(
            {
                "data": {
                    "e": "trade",
                    "E": 1_787_558_400_150,
                    "s": "BTCUSDT",
                    "t": 123,
                    "p": "105120.1",
                    "q": "0.125",
                    "T": 1_787_558_400_123,
                    "m": True,
                },
            },
            ["btcusdt"],
        )

        self.assertIsNotNone(record)
        self.assertIs(record["is_buyer_maker"], True)

    def test_normalize_trade_rejects_non_boolean_maker_flag(self):
        record = normalize_binance_trade_record(
            {
                "data": {
                    "e": "trade",
                    "E": 1_787_558_400_150,
                    "s": "BTCUSDT",
                    "t": 123,
                    "p": "105120.1",
                    "q": "0.125",
                    "T": 1_787_558_400_123,
                    "m": "true",
                },
            },
            ["btcusdt"],
        )

        self.assertIsNone(record)


if __name__ == "__main__":
    unittest.main()

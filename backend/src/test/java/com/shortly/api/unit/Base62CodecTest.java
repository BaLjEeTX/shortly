package com.shortly.api.unit;

import com.shortly.api.service.Base62Codec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;

// Base62Codec: pure logic, easy to test exhaustively
class Base62CodecTest {

    private final Base62Codec codec = new Base62Codec();

    @Test
    void encodesZero() {
        assertThat(codec.encode(0)).isEqualTo("0");
    }

    @Test
    void encodesBaseBoundary() {
        assertThat(codec.encode(61)).isEqualTo("z");
        assertThat(codec.encode(62)).isEqualTo("10");
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 100, 1_000_000, Long.MAX_VALUE / 2})
    void roundTrip(long id) {
        assertThat(codec.decode(codec.encode(id))).isEqualTo(id);
    }

    @Test
    void rejectsNegative() {
        assertThatThrownBy(() -> codec.encode(-1))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
